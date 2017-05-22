'use strict';

const apiai = require('apiai');
const config = require('./config');
const express = require('express');
const crypto = require('crypto');
const bodyParser = require('body-parser');
const request = require('request');
const app = express();
const uuid = require('uuid');
const xlsxtojson = require("xlsx-to-json-lc");


// Messenger API parameters
if (!config.FB_PAGE_TOKEN) {
	throw new Error('missing FB_PAGE_TOKEN');
}
if (!config.FB_VERIFY_TOKEN) {
	throw new Error('missing FB_VERIFY_TOKEN');
}
if (!config.API_AI_CLIENT_ACCESS_TOKEN) {
	throw new Error('missing API_AI_CLIENT_ACCESS_TOKEN');
}
if (!config.FB_APP_SECRET) {
	throw new Error('missing FB_APP_SECRET');
}
if (!config.SERVER_URL) { //used for ink to static files
	throw new Error('missing SERVER_URL');
}



app.set('port', (process.env.PORT || 5000))

//verify request came from facebook
app.use(bodyParser.json({
	verify: verifyRequestSignature
}));

//serve static files in the public directory
app.use(express.static('public'));

// Process application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({
	extended: false
}))

// Process application/json
app.use(bodyParser.json())




const apiAiService = apiai(config.API_AI_CLIENT_ACCESS_TOKEN, {
	language: "fr",
	requestSource: "fb"
});
const sessionIds = new Map();

// Index route
app.get('/', function (req, res) {
	res.send('Hello world, I am a chat bot')
})

// for Facebook verification
app.get('/webhook/', function (req, res) {
	console.log("request");
	if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === config.FB_VERIFY_TOKEN) {
		res.status(200).send(req.query['hub.challenge']);
	} else {
		console.error("Failed validation. Make sure the validation tokens match.");
		res.sendStatus(403);
	}
})

/*
 * All callbacks for Messenger are POST-ed. They will be sent to the same
 * webhook. Be sure to subscribe your app to your page to receive callbacks
 * for your page. 
 * https://developers.facebook.com/docs/messenger-platform/product-overview/setup#subscribe_app
 *
 */
app.post('/webhook/', function (req, res) {
	var data = req.body;
	console.log(JSON.stringify(data));



	// Make sure this is a page subscription
	if (data.object == 'page') {
		// Iterate over each entry
		// There may be multiple if batched
		data.entry.forEach(function (pageEntry) {
			var pageID = pageEntry.id;
			var timeOfEvent = pageEntry.time;

			// Iterate over each messaging event
			pageEntry.messaging.forEach(function (messagingEvent) {
				if (messagingEvent.optin) {
					receivedAuthentication(messagingEvent);
				} else if (messagingEvent.message) {
					receivedMessage(messagingEvent);
				} else if (messagingEvent.read) {
					receivedMessageRead(messagingEvent);
				} else {
					console.log("Webhook received unknown messagingEvent: ", messagingEvent);
				}
			});
		});

		// Assume all went well.
		// You must send back a 200, within 20 seconds
		res.sendStatus(200);
	}
});





function receivedMessage(event) {

	var senderID = event.sender.id;
	var recipientID = event.recipient.id;
	var timeOfMessage = event.timestamp;
	var message = event.message;

	if (!sessionIds.has(senderID)) {
		sessionIds.set(senderID, uuid.v1());
	}
	//console.log("Received message for user %d and page %d at %d with message:", senderID, recipientID, timeOfMessage);
	//console.log(JSON.stringify(message));
	// You may get a text or attachment but not both
	var messageText = message.text;


	if (messageText) {
		//send message to api.ai
		sendToApiAi(senderID, messageText);
	}
}

function handleApiAiAction(sender, action, responseText, contexts, parameters) {
	switch (action) {
		default:
			//unhandled action, just send back the text
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

function handleApiAiResponse(sender, response) {
	let responseText = response.result.fulfillment.speech;
	let responseData = response.result.fulfillment.data;
	let messages = response.result.fulfillment.messages;
	let action = response.result.action;
	let contexts = response.result.contexts;
	let parameters = response.result.parameters;

	sendTypingOff(sender);
	if (responseText == '' && !isDefined(action)) {
		//api ai could not evaluate input.
		console.log('Unknown query' + response.result.resolvedQuery);
		sendTextMessage(sender, "I'm not sure what you want. Can you be more specific?");
	} else if (isDefined(action)) {
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

/*
 * Turn typing indicator on
 *
 */
function sendTypingOn(recipientId) {


	var messageData = {
		recipient: {
			id: recipientId
		},
		sender_action: "typing_on"
	};

	callSendAPI(messageData);
}

/*
 * Turn typing indicator off
 *
 */
function sendTypingOff(recipientId) {


	var messageData = {
		recipient: {
			id: recipientId
		},
		sender_action: "typing_off"
	};

	callSendAPI(messageData);
}

/*
 * Call the Send API. The message data goes in the body. If successful, we'll 
 * get the message id in a response 
 *
 */
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
				console.log("Successfully sent message with id %s to recipient %s",
					messageId, recipientId);
			} else {
				console.log("Successfully called Send API for recipient %s",
					recipientId);
			}
		} else {
			console.error("Failed calling Send API", response.statusCode, response.statusMessage, body.error);
		}
	});
}

/*
 * Message Read Event
 *
 * This event is called when a previously-sent message has been read.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-read
 * 
 */
function receivedMessageRead(event) {
	var senderID = event.sender.id;
	var recipientID = event.recipient.id;

	// All messages before watermark (a timestamp) or sequence have been seen.
	var watermark = event.read.watermark;
	var sequenceNumber = event.read.seq;

	console.log("Received message read event for watermark %d and sequence " +
		"number %d", watermark, sequenceNumber);
}

/*
 * Authorization Event
 *
 * The value for 'optin.ref' is defined in the entry point. For the "Send to 
 * Messenger" plugin, it is the 'data-ref' field. Read more at 
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/authentication
 *
 */
function receivedAuthentication(event) {
	var senderID = event.sender.id;
	var recipientID = event.recipient.id;
	var timeOfAuth = event.timestamp;

	// The 'ref' field is set in the 'Send to Messenger' plugin, in the 'data-ref'
	// The developer can set this to an arbitrary value to associate the 
	// authentication callback with the 'Send to Messenger' click event. This is
	// a way to do account linking when the user clicks the 'Send to Messenger' 
	// plugin.
	var passThroughParam = event.optin.ref;

	console.log("Received authentication for user %d and page %d with pass " +
		"through param '%s' at %d", senderID, recipientID, passThroughParam,
		timeOfAuth);

	// When an authentication is received, we'll send a message back to the sender
	// to let them know it was successful.
	sendTextMessage(senderID, "Authentication successful");
}

/*
 * Verify that the callback came from Facebook. Using the App Secret from 
 * the App Dashboard, we can verify the signature that is sent with each 
 * callback in the x-hub-signature field, located in the header.
 *
 * https://developers.facebook.com/docs/graph-api/webhooks#setup
 *
 */
function verifyRequestSignature(req, res, buf) {
	var signature = req.headers["x-hub-signature"];

	if (!signature) {
		throw new Error('Couldn\'t validate the signature.');
	} else {
		var elements = signature.split('=');
		var method = elements[0];
		var signatureHash = elements[1];

		var expectedHash = crypto.createHmac('sha1', config.FB_APP_SECRET)
			.update(buf)
			.digest('hex');

		if (signatureHash != expectedHash) {
			throw new Error("Couldn't validate the request signature.");
		}
	}
}

function isDefined(obj) {
	if (typeof obj == 'undefined') {
		return false;
	}

	if (!obj) {
		return false;
	}

	return obj != null;
}

function parseExcel() {
    xlsxtojson({
        input: config.fichier,
        output: "output.json",
        lowerCaseHeaders: true
    });
}

// Spin up the server
app.listen(app.get('port'), function () {
	console.log('running on port', app.get('port'))
})
