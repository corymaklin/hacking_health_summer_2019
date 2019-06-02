require('dotenv').config()
const fetch = require('node-fetch');
var async = require("async");
var bodyParser = require('body-parser');
var jsonParser = bodyParser.json();
var Redis = require("redis");
const mongoose = require('mongoose');

// Creates database if it can't find it or uses it if it already exists
mongoose.connect('mongodb://localhost/users')

const usersSchema = mongoose.Schema({
	_id: String,
	// steps: Number,
	steps: Array,
	// startTime: String,
	fullName: String
})

var User = mongoose.model('User', usersSchema)

var rds = Redis.createClient();

// initialize the express application
const express = require("express");
const app = express();

// initialize the Fitbit API client
const FitbitApiClient = require("fitbit-node");
const client = new FitbitApiClient({
	clientId: process.env.CLIENT_ID,
	clientSecret: process.env.CLIENT_SECRET,
	apiVersion: '1.2' // 1.2 is the default
});

// redirect the user to the Fitbit authorization page
app.get("/authorize", (req, res) => {
	res.redirect(client.getAuthorizeUrl('activity heartrate location nutrition profile settings sleep social weight', process.env.CALLBACK_URL));
});

// handle the callback from the Fitbit authorization flow
app.get("/callback", (req, res) => {
    // exchange the authorization code we just received for an access token
	client.getAccessToken(req.query.code, process.env.CALLBACK_URL).then(result => {

        saveToken( '1', result, ( err, access_token ) => {
            fetch('https://api.fitbit.com/1/user/-/apiSubscriptions/1.json', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${access_token}` },
            })
            .then(res => res.json())
            .then(json => res.send(json));
		});

	}).catch(err => {
		res.status(err.status).send(err);
	});
});

// the webhook GET is the endpoint to verify the endpoint by the fitbit servers
app.get("/webhook", (req, res) => {
	if(req.query.verify === process.env.SUBSCRIPTION_VERIFY){
		// should return 204 if the verify query matches
		console.log("WEBHOOK-VERIFY - OK");
		res.sendStatus( 204 );
	} else {
		// should return 404 if the code will not match
		console.log("WEBHOOK-VERIFY - Failed");
		res.sendStatus( 404 );
	}
});

app.get("/users", (req, res) => {
	User.find({}, (err, users) => {
		if (err) {
			console.log('No ERROR!')
			console.log(err)
		} else {
			console.log('responding with users...')
			res.send(users)
		}
	})
});

app.post("/webhook", jsonParser, (req, res) => {
    // console.log(res)

    async.eachLimit( req.body, 3, readFitbitData, err => {
		if ( err ) {
			console.log("WEBHOOK-DATA-ERROR", err);
		} else {
			console.log( "WEBHOOK-DATA PROCESSING DONE" );
		}
	});

    res.sendStatus( 204 );
});

// function used by async to receive the data of each subscription event
var readFitbitData = function( data, cb ){
	// grab the relevant data
	var user_id = data.subscriptionId; // your internal user
	var date = data.date; // the data date
	var fitbit_user = data.ownerId; // the fitbit user
	var type = data.collectionType; // the fitbit data type
	console.log("READFITBIT DATA `" + type + "` for user `" + user_id + "`");
	
	// create the body subscription with the user id from the authorize route
	getToken( user_id, function( err, access_token ) {
		if ( err ) {
			cb( err );
			return;
		}
		// create fitbit url based on type
		var _url = getFitbitUrl( type, { date: date } );

		client.get( _url, access_token, fitbit_user )
			.then(function (results) {
				console.log("RECEIVED CHANGED DATA `" + type + "` for user `" + user_id + "`", results[0] );

				// startTime = results[0].activities[0].originalStartTime
				// steps = results[0].summary.steps
				console.log(results[0].summary)

				console.log(fitbit_user)

				client.get("/profile.json", access_token).then(results => {

					fullName = results[0].user.fullName

					client.get('/activities/steps/date/today/1m.json', access_token).then(results => {

						// console.log(results[0][["activities-steps"]])
						steps = results[0]["activities-steps"]

						User.update(
							{
								_id: user_id,
							},
							{
								_id: user_id,
								steps: steps,
								// startTime: startTime,
								fullName: fullName,
							},
							{
								upsert: true
							}, (err, user) => {
								if (err) {
									console.log('Something went wrong');
									console.log(err)
								} else {
									console.log('We just saved a user');
									console.log(user);
								}
							}
						)
					})

				}).catch(err => {
					// res.status(err.status).send(err);
					console.log('an error occurred')
					console.log(err)
				});

				cb( null );
			}).catch(function (error) {
				cb( error );
			});		
	});
};

// small helper function to create the fitbit url based on the webhook data collectionType 
var getFitbitUrl = function( type, data ){
	var _urls = {
		body: "/body/log/weight/date/[date].json",
		activities: "/activities/date/[date].json"
	};
	
	// replace the [key]'s with the passed data'
	if( _urls[ type ] ){
		var _url = _urls[ type ];
		var _k;
		for( _k in data ){
			_url = _url.replace( "["+_k+"]", data[ _k ] );
		}
		
		return _url;
	}
	console.error( "Type not found" );
	return null;
};

var getToken = function( user_id, cb ){
	rds.hget( "fitbit-subscription-example", user_id, function( err, resp ){
		if( err ){
			cb( err );
			return;
		}
		if( !resp ){
			cb( new Error( "ENOTFOUND" ) );
			return;
		}
		var _data = JSON.parse( resp );
		if( _data.expire_ts < Date.now() ){
			refreshToken( user_id, _data, cb );
			return;
		}
		cb( null, _data.access_token );
	});
};

var refreshToken = function( user_id, data, cb ){
	client.refreshAccesstoken( data.access_token, data.refresh_token )
	.then(function (refreshToken) {
		console.log("REFRESHED TOKEN", refreshToken );
		
		data.access_token = refreshToken;
		
		rds.hset( "fitbit-subscription-example", user_id, JSON.stringify( data ), function( err ){
			if( err ){
				cb( err );
				return;
			}
			console.log("SAVED REFRESHED TOKEN for user `" + user_id + "`");
			cb( null, data.access_token );
		});
	}).catch(function (error) {
		cb( error );
	});
};

var saveToken = function( user_id, data, cb ){
	var _data = {
		access_token: data.access_token,
		refresh_token: data.refresh_token,
		user_id: data.user_id,
		fitbit_user: data.user_id,
		scope: data.scope,
		expire_ts: Date.now() + ( 1000 * data.expires_in )
	};
	
	rds.hset( "fitbit-subscription-example", user_id, JSON.stringify( _data ), function( err ){
		if( err ){
			cb( err );
			return;
		}
		console.log("SAVED TOKEN for user `" + user_id + "`");
		cb( null, _data.access_token );
	});
};

// launch the server
app.listen(8081);