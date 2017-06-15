'use strict';

const apiai = require('apiai');  //pour se connecter avec l'api.ai
const config = require('./config');  //l'access au fichier de configuration
const express = require('express');  //framework pour développer les applications web
const crypto = require('crypto');  //framwork pour verifier l'autourisation
const bodyParser = require('body-parser');  //framework pour créer des middlewares pour parser les requests données
const request = require('request');  //framework pour faire des http calls
const app = express();
const uuid = require('uuid');  //framework pour générer  RFC4122 UUIDS
var promise = require('bluebird');  //framework pour utiliser les promises
var options = {
    promiseLib: promise
};
var pgp = require('pg-promise')(options);  //pour se connecter a la base de données
var db=pgp(process.env.DATABASE_URL);  //se connecter a la base de données



// Messenger API parameters
if (!config.FB_PAGE_TOKEN) {
	throw new Error('FB_PAGE_TOKEN vide');
}
if (!config.FB_VERIFY_TOKEN) {
	throw new Error('FB_VERIFY_TOKEN vide');
}
if (!config.API_AI_CLIENT_ACCESS_TOKEN) {
	throw new Error('API_AI_CLIENT_ACCESS_TOKEN vide');
}
if (!config.FB_APP_SECRET) {
	throw new Error('FB_APP_SECRET vide');
}
if (!config.SERVER_URL) { //used for ink to static files
	throw new Error('SERVER_URL vide');
}



app.set('port', (process.env.PORT || 5000))




//verify la request qui arrive de facebook
app.use(bodyParser.json({
	verify: verifyRequestSignature
}));

// Process l'application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({
	extended: false
}))

// Process l'application/json
app.use(bodyParser.json())

//public dossier
app.use(express.static('public'));


//choisir la langue et la source de request
const apiAiService = apiai(config.API_AI_CLIENT_ACCESS_TOKEN, {
	language: "fr",
	requestSource: "fb"
});
const sessionIds = new Map();

// l'idex route
app.get('/', function (req, res) {
	res.send('Salut tout le monde, moi le chatbot')
})

// verifier la connecxion avec facebook
app.get('/webhook/', function (req, res) {
	console.log("request");
	if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === config.FB_VERIFY_TOKEN) {
		res.status(200).send(req.query['hub.challenge']);
	} else {
		console.error("Echec de validation.");
		res.sendStatus(403);
	}
})

app.post('/webhook/', function (req, res) {
	var data = req.body;
	console.log(JSON.stringify(data));



	// Verifier que c'est une facebook page
	if (data.object == 'page') {

		//Pour chaque page entrée
		data.entry.forEach(function (pageEntry) {
			var pageID = pageEntry.id;
			var timeOfEvent = pageEntry.time;

			// Repeter pour chaque evenement
			pageEntry.messaging.forEach(function (messagingEvent) {
				if (messagingEvent.optin) {
					receivedAuthentication(messagingEvent);
				} else if (messagingEvent.message) {
					receivedMessage(messagingEvent);
				} else if (messagingEvent.read) {
					receivedMessageRead(messagingEvent);
				} else if (messagingEvent.postback) {
                    receivedPostback(messagingEvent);
                } else {
					console.log("Webhook recevoir non existe evenement: ", messagingEvent);
				}
			});
		});

		// Envoyer la code 200 qui signifie que tout va bien dans moins de 20 seconds
		res.sendStatus(200);
	}
});



//Gerer le message recevoir de facebook messenger

function receivedMessage(event) {

	var senderID = event.sender.id;
	var recipientID = event.recipient.id;
	var timeOfMessage = event.timestamp;
	var message = event.message;

	if (!sessionIds.has(senderID)) {
		sessionIds.set(senderID, uuid.v1());
	}

	var messageText = message.text;


	if (messageText) {
		//Envoyer la message vers api.ai
		sendToApiAi(senderID, messageText);
	}
}

function handleApiAiAction(sender, action, responseText, contexts, parameters) {
	switch (action) {
		case "smalltalk.greetings.hello":
			let replies=[
				{
					"content_type":"text",
					"title":"Projet & Fonction",
					"payload":"projet_fonction"
				},
				{
                    "content_type":"text",
                    "title":"Projet",
                    "payload":"projet"
				},
                {
                    "content_type":"text",
                    "title":"Personne",
                    "payload":"personne"
                },
			];
			sendQuickReply(sender,responseText,replies);
			break;

		case "position":
			let replies1=[
				{
					"content_type":"location",
				}
			];
			sendQuickReply(sender,responseText,replies1);
			break;

		default:
			//Si l'action existe pas envoie la text default
			sendTextMessage(sender, responseText);
	}
}

function handleMessage(message, sender) {
	switch (message.type) {
		case 0: //text
			sendTextMessage(sender, message.speech);
			break;
	}
}

//Recupirer les informations dans la reponse d'api.ai
function handleApiAiResponse(sender, response) {
	let responseText = response.result.fulfillment.speech;
	let action = response.result.action;
	let contexts = response.result.contexts;
	let parameters = response.result.parameters;
	let intentName=response.result.metadata.intentName;
	let text="";

	//Traiter la reponse pour chaque intent dans l'api.ai
	if(intentName==="projet_fonction"){
        let fonction;
        let projet;
        let fonction1 = response.result.parameters.fonction1;
        let fonction2 = response.result.parameters.fonction2;
        let fonction3 = response.result.parameters.fonction3;
        let projet1 = response.result.parameters.projet1;
        let projet2 = response.result.parameters.projet2;
        let projet3 = response.result.parameters.projet3;
        if (fonction2 === "" && fonction3 === "") {
            fonction = fonction1;
        } else if (fonction3 === "") {
            fonction = fonction1 + " " + fonction2;
        } else {
            fonction = fonction1 + " " + fonction2 + " " + fonction3;
        }
        if (projet2 === "" && projet3 === "") {
            projet = projet1;
        } else if (projet3 === "") {
            projet = projet1 + " " + projet2;
        } else {
            projet = projet1 + " " + projet2 + " " + projet3;
        }
        projet=projet.toLowerCase();
        fonction=fonction.toLowerCase();
        db.any(`SELECT personne FROM projet WHERE projet='${projet}' AND fonction='${fonction}'`)
            .then(data => {
                for (var i in data){
                    text=text+data[i].personne+" ";
                }
                if (text==="") {
                    handleApiAiAction(sender, action, config.messageError, contexts, parameters);
                }else {
                    handleApiAiAction(sender, action, text, contexts, parameters);
				}

            })
            .catch(error =>{
                console.log('ERROR:', error);
            });
	}else if(intentName==="projet"){
        let projet;
        let projet1=response.result.parameters.projet1;
        let projet2=response.result.parameters.projet2;
        let projet3=response.result.parameters.projet3;
        if (projet2==="" && projet3===""){
            projet=projet1;
        }else if (projet3===""){
            projet=projet1+" "+projet2;
        }else {
            projet=projet1+" "+projet2+" "+projet3;
        }
        projet=projet.toLowerCase();
        db.any(`SELECT personne,fonction FROM projet WHERE projet='${projet}'`)
            .then(data => {
                for (var i in data){
                    text=text+"La personne: "+data[i].personne+" et ca fonction: "+data[i].fonction+" ";
                }
                if (text===""){
                    handleApiAiAction(sender, action, config.messageError, contexts, parameters);
                } else {
                    handleApiAiAction(sender, action, text, contexts, parameters);
                }
            })
            .catch(error =>{
                console.log('ERROR:', error);
            });
	}else if (intentName==="personne"){
        let personne;
        let prenom=response.result.parameters.prenom1;
        let nom=response.result.parameters.nom1;
        personne=prenom+" "+nom;
        personne=personne.toLowerCase();
        db.any(`SELECT projet,fonction FROM projet WHERE personne='${personne}'`)
            .then(data => {
                for (var i in data){
                    text=text+"Le projet: "+data[i].projet+" et ca fonction: "+data[i].fonction+" ";
                }
                if (text===""){
                    handleApiAiAction(sender, action, config.messageError, contexts, parameters);
                } else {
                    handleApiAiAction(sender, action, text, contexts, parameters);
                }
            })
            .catch(error =>{
                console.log('ERROR:', error);
            });
    }else if (intentName==="list" ) {
        let table=response.result.parameters.table1;
        table=table.toLowerCase();
        db.any(config.selectAll)
            .then(data => {
                for (var i in data){
                    text=text+"Le projet: "+data[i].projet+" et la fonction: "+data[i].fonction+" et le prenom nom: "+data[i].personne+" ";
                }
                if (text===""){
                    handleApiAiAction(sender, action, config.messageError, contexts, parameters);
                } else {
                    handleApiAiAction(sender, action, text, contexts, parameters);
                }
            })
            .catch(error =>{
                console.log('ERROR:', error);
            });
    } else if (intentName==="signifie"){
        let syno=response.result.parameters.syno1;
        syno=syno.toLowerCase();
        db.any(`SELECT def FROM synonyme WHERE synonyme='${syno}'`)
            .then(data => {
                for (var i in data){
                    text=text+data[i].def+" ";
                }
                if (text===""){
                    handleApiAiAction(sender, action, config.messageError, contexts, parameters);
                } else {
                    handleApiAiAction(sender, action, text, contexts, parameters);
                }
            })
            .catch(error =>{
                console.log('ERROR:', error);
            });
    } else if (intentName==="date") {
        let jalon;
        let projet;
        let jalon1 = response.result.parameters.d1;
        let jalon2 = response.result.parameters.d2;
        let jalon3 = response.result.parameters.d3;
        let projet1 = response.result.parameters.na1;
        let projet2 = response.result.parameters.na2;
        let projet3 = response.result.parameters.na3;
        if (jalon2 === "" && jalon3 === "") {
            jalon = jalon1;
        } else if (jalon3 === "") {
            jalon = jalon1 + " " + jalon2;
        } else {
            jalon = jalon1 + " " + jalon2 + " " + jalon3;
        }
        if (projet2 === "" && projet3 === "") {
            projet = projet1;
        } else if (projet3 === "") {
            projet = projet1 + " " + projet2;
        } else {
            projet = projet1 + " " + projet2 + " " + projet3;
        }
        jalon = jalon.toLowerCase();
        projet = projet.toLowerCase();
        db.any(`SELECT date FROM date WHERE nomprojet='${projet}' AND jalon='${jalon}'`)
            .then(data => {
                for (var i in data) {
                    text = text + data[i].date + " ";
                }
                if (text === "") {
                    handleApiAiAction(sender, action, config.messageError, contexts, parameters);
                } else {
                    handleApiAiAction(sender, action, text, contexts, parameters);
                }

            })
            .catch(error => {
                console.log('ERROR:', error);
            });
    } else if (intentName==='fuck'){
        sendGifMessage(sender);
    } else if (intentName==='parle'){
        sendAudioMessage(sender);
    } else {
            handleApiAiAction(sender, action, responseText, contexts, parameters);
	}


}

function sendToApiAi(sender, text) {

	sendTypingOn(sender);
	let apiaiRequest = apiAiService.textRequest(text, {
		sessionId: sessionIds.get(sender)
	});

	apiaiRequest.on('response', (response) => {
		if (isDefined(response.result)) {
			handleApiAiResponse(sender, response);
		}
	});

	apiaiRequest.on('error', (error) => console.error(error));
	apiaiRequest.end();
}



//Envoyer la reponse vers facebook messenger
function sendTextMessage(recipientId, text) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			text: text
		}
	}
	callSendAPI(messageData);
}

//Set l'écrire sur facebook on
function sendTypingOn(recipientId) {


	var messageData = {
		recipient: {
			id: recipientId
		},
		sender_action: "typing_on"
	};

	callSendAPI(messageData);
}

//Set l'écrire sur facebook off
function sendTypingOff(recipientId) {


	var messageData = {
		recipient: {
			id: recipientId
		},
		sender_action: "typing_off"
	};

	callSendAPI(messageData);
}

//traiter la connexion avec l'api.ai
function callSendAPI(messageData) {
	request({
		uri: 'https://graph.facebook.com/v2.6/me/messages',
		qs: {
			access_token: config.FB_PAGE_TOKEN
		},
		method: 'POST',
		json: messageData

	}, function (error, response, body) {
		if (!error && response.statusCode == 200) {
			var recipientId = body.recipient_id;
			var messageId = body.message_id;

			if (messageId) {
				console.log("Envoyer message avec id %s pour %s",
					messageId, recipientId);
			} else {
				console.log("Réussir la connection avec l'API %s",
					recipientId);
			}
		} else {
			console.error("Echec de connection avec API", response.statusCode, response.statusMessage, body.error);
		}
	});
}

//L'evenement pour lire le message
function receivedMessageRead(event) {
	var senderID = event.sender.id;
	var recipientID = event.recipient.id;

	var watermark = event.read.watermark;
	var sequenceNumber = event.read.seq;

	console.log("Recevoir message de lire pour watermark %d et sequence " +
		"number %d", watermark, sequenceNumber);
}

// Recevoir l'autourisation
function receivedAuthentication(event) {
	var senderID = event.sender.id;
	var recipientID = event.recipient.id;
	var timeOfAuth = event.timestamp;

	var passThroughParam = event.optin.ref;

	console.log("Recevoir authentication pour l'utulisateur %d et la page %d avec mot de pass " +
		"parle param '%s' en %d", senderID, recipientID, passThroughParam,
		timeOfAuth);

	sendTextMessage(senderID, "Authentication ok");
}

//Verifier la signature pour chaque request qu'il vient de facebbok et qu'il utulise la meme code secrets
function verifyRequestSignature(req, res, buf) {
	var signature = req.headers["x-hub-signature"];

	if (!signature) {
		throw new Error('Echec validation de signature.');
	} else {
		var elements = signature.split('=');
		var method = elements[0];
		var signatureHash = elements[1];

		var expectedHash = crypto.createHmac('sha1', config.FB_APP_SECRET)
			.update(buf)
			.digest('hex');

		if (signatureHash != expectedHash) {
			throw new Error("Echec validation de request signature.");
		}
	}
}

//Si l'action est définie ou pas définie
function isDefined(obj) {
	if (typeof obj == 'undefined') {
		return false;
	}

	if (!obj) {
		return false;
	}

	return obj != null;
}

//Envoyer des messages avec des QuickReplay
function sendQuickReply(recipientId, text, replies, metadata) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            text: text,
            metadata: isDefined(metadata)?metadata:'',
            quick_replies: replies
        }
    };

    callSendAPI(messageData);
}

//Recuperer les Informations d'un utilisateur facebook
function greetUserText(userId) {
    //Lire le nom d'utilisateur
    request({
        uri: 'https://graph.facebook.com/v2.7/' + userId,
        qs: {
            access_token: config.FB_PAGE_TOKEN
        }

    }, function (error, response, body) {
        if (!error && response.statusCode == 200) {

            var user = JSON.parse(body);

            if (user.first_name) {
                console.log("FB utilisateur: %s %s, %s",
                    user.first_name, user.last_name, user.gender);

                sendTextMessage(userId, "Bienvenue " + user.first_name + '!');
            } else {
                console.log("Je peux pas recuperer les info d'id",
                    userId);
            }
        } else {
            console.error(response.error);
        }

    });
}

//Gerer les Postback event
function receivedPostback(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var timeOfPostback = event.timestamp;

    // The 'payload' param is a developer-defined field which is set in a postback
    // button for Structured Messages.
    var payload = event.postback.payload;

    switch (payload) {
		case "Get_STARTED":
		    //Salutation message
			greetUserText(senderID);
			break;

        case "music":
            //vocale message
            sendAudioMessage(senderID);
            break;

        default:
            //unindentified payload
            sendTextMessage(senderID, "I'm not sure what you want. Can you be more specific?");
            break;

    }

    console.log("Received postback for user %d and page %d with payload '%s' " +
        "at %d", senderID, recipientID, payload, timeOfPostback);

}

//Envoyer un Gif message
function sendGifMessage(recipientId) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "image",
                payload: {
                    url: config.SERVER_URL + "/GIF/pardon.gif"
                }
            }
        }
    };

    callSendAPI(messageData);
}

//Envoyer un message vocale
function sendAudioMessage(recipientId) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "audio",
                payload: {
                    url: config.SERVER_URL + "/audio/sample.mp3"
                }
            }
        }
    };

    callSendAPI(messageData);
}

// Connéxion au serveur
app.listen(app.get('port'), function () {
	console.log('Sur la port', app.get('port'))
})
