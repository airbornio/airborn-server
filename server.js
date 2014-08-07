var newrelic = require('newrelic');

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var express = require('express');
var app = express();

var pg = require('pg.js');

var AWS = require('aws-sdk');
var s3 = new AWS.S3();

var visualCaptcha;

app.use(express.json());

app.use(express.cookieParser());
app.use(express.cookieSession({secret: process.env.COOKIE_SESSION_SECRET}));

app.get('/', function(req, res) {
	res.sendfile('bootstrap.html');
});
app.get('/content', function(req, res) {
	res.sendfile('content.html');
});
app.get('/register', function(req, res) {
	res.sendfile('register.html');
});
app.get('/sjcl.js', function(req, res) {
	res.sendfile('sjcl.js');
});
app.get('/lang.json', function(req, res) {
	res.set('Access-Control-Allow-Origin', '*');
	res.sendfile('lang.json');
});
app.get(/^\/(?:bootstrap|content|register)\.(?:js|css)$/, function(req, res) {
	res.sendfile(req.path.substr(1));
});
app.get(/^\/3rdparty\/.+\.(?:js|css|png)$/, function(req, res) {
	res.sendfile(req.path.substr(1));
});
app.get(/^\/images\/.+\.png$/, function(req, res) {
	res.sendfile(req.path.substr(1));
});

app.get('/user/:username/salt', function(req, res) {
	var username = req.param('username');
	req.session.username = username;
	pg.connect(process.env.DATABASE_URL, function(err, client, done) {
		if(err) {
			console.error(err);
			res.send(500);
			return;
		}
		client.query('SELECT salt FROM users WHERE username = $1', [username], function(err, result) {
			done();
			if(err || !result.rows[0]) {
				console.error(err);
				res.send(500);
				return;
			}
			res.send(200, result.rows[0].salt);
		});
	});
});

app.get(/^\/object\/(.+)$/, function(req, res) {
	var authkey = req.get('X-Authentication');
	if(authkey) {
		login(req, res, authkey, cont);
	} else if(!userLoggedIn(req)) {
		res.send(403);
		return;
	} else {
		cont();
	}
	function cont() {
		var stream = s3.getObject({Bucket: 'laskya-cloud', Key: req.route.params[0]}).createReadStream();
		stream.pipe(res);
		stream.on('error', function(err) {
			console.error(err);
			res.send(err.statusCode);
		});
	}
});

app.get(/^\/sign_s3_(put|copy_(.+))$/, function(req, res) {
	if(!userLoggedIn(req)) {
		res.send(403);
		return;
	}

	var method = req.route.params[0];
	
	var object_name = req.query.s3_object_name;
	var mime_type = req.query.s3_object_type;

	if(req.query.s3_object_name.substr(0, 17) !== req.session.S3Prefix + '/') {
		res.send(403);
		return;
	}

	var now = new Date();
	var expires = Math.ceil((now.getTime() + 600000)/1000); // 10 minutes from now
	var amz_headers = 'x-amz-acl:public-read';
	if(method !== 'put') amz_headers += '\nx-amz-copy-source:/' + process.env.S3_BUCKET_NAME + '/' + req.route.params[1];

	var put_request = 'PUT\n\n'+mime_type+'\n'+expires+'\n'+amz_headers+'\n/'+process.env.S3_BUCKET_NAME+'/'+object_name;

	var signature = crypto.createHmac('sha1', new Buffer(process.env.AWS_SECRET_ACCESS_KEY, 'ascii')).update(put_request).digest('base64');
	signature = encodeURIComponent(signature.trim());
	signature = signature.replace('%2B','+');

	var url = 'https://'+process.env.S3_BUCKET_NAME+'.s3.amazonaws.com/'+object_name;

	var credentials = {
		req: put_request,
		signed_request: url+'?AWSAccessKeyId='+process.env.AWS_ACCESS_KEY_ID+'&Expires='+expires+'&Signature='+signature,
		url: url
	};
	res.send(JSON.stringify(credentials));
});

app.post('/register', function(req, res) {
	if(!req.session.ishuman) {
		res.send(403);
		return;
	}
	pg.connect(process.env.DATABASE_URL, function(err, client, done) {
		if(err) {
			console.error(err);
			res.send(500);
			return;
		}
		var id = guid().replace(/-/g, '').toUpperCase();
		var username = req.body.username;
		var salt = req.body.salt;
		var authkey = req.body.authkey;
		var S3Prefix = crypto.createHmac('sha256', new Buffer(authkey, 'hex')).update(username).digest('hex').substr(0, 16);
		client.query('INSERT INTO users (id, username, salt, authkey, S3Prefix) VALUES ($1, $2, $3, $4)', [id, username, salt, authkey, S3Prefix], function(err, result) {
			done();
			if(err) {
				console.error(err);
				res.send(500);
				return;
			}
			req.session.username = username;
			login(req, res, authkey, function() {
				res.send(200);
			});
		});
	});
});

var server = app.listen(process.env.PORT || 8080, function() {
	console.log('Listening on port %d', server.address().port);
});

function login(req, res, authkey, cont) {
	pg.connect(process.env.DATABASE_URL, function(err, client, done) {
		if(err) {
			console.error(err);
			res.send(500);
			return;
		}
		client.query('SELECT id, authkey, S3Prefix FROM users WHERE username = $1', [req.session.username], function(err, result) {
			done();
			if(err || !result.rows[0]) {
				console.error(err);
				res.send(500);
				return;
			}
			if(result.rows[0].authkey === authkey) {
				req.session.userID = result.rows[0].id;
				req.session.S3Prefix = result.rows[0].S3Prefix;
				delete req.session.username;
				cont();
			} else {
				res.send(401);
			}
		});
	});
}

function userLoggedIn(req) {
	return req.session.userID !== undefined;
}

function guid() {
	var d = new Date().getTime();
	var uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
		var r = (d + Math.random()*16)%16 | 0;
		d = Math.floor(d/16);
		return (c=='x' ? r : (r&0x7|0x8)).toString(16);
	});
	return uuid;
}


/********* visualCaptcha *********/

// Define routes functions
// Fetches and streams an audio file
function _getAudio( req, res, next ) {
	// Default file type is mp3, but we need to support ogg as well
	if ( req.params.type !== 'ogg' ) {
		req.params.type = 'mp3';
	}

	visualCaptcha.streamAudio( res, req.params.type );
};

// Fetches and streams an image file
function _getImage( req, res, next ) {
	var isRetina = false;

	// Default is non-retina
	if ( req.query.retina ) {
		isRetina = true;
	}

	visualCaptcha.streamImage( req.params.index, res, isRetina );
};

// Start and refresh captcha options
function _startRoute( req, res, next ) {

	// After initializing visualCaptcha, we only need to generate new options
	if ( ! visualCaptcha ) {
		visualCaptcha = require( 'visualcaptcha' )( req.session, req.query.namespace );
	}
	visualCaptcha.generate( req.params.howmany );

	// We have to send the frontend data to use on POST.
	res.send( 200, visualCaptcha.getFrontendData() );
};

// Try to validate the captcha
// We need to make sure we generate new options after trying to validate, to avoid abuse
function _trySubmission( req, res, next ) {
	var namespace = req.query.namespace,
		frontendData,
		queryParams = [],
		imageAnswer,
		audioAnswer,
		responseStatus,
		responseObject;

	frontendData = visualCaptcha.getFrontendData();

	// Add namespace to query params, if present
	if ( namespace && namespace.length !== 0 ) {
		queryParams.push( 'namespace=' + namespace );
	}

	// It's not impossible this method is called before visualCaptcha is initialized, so we have to send a 404
	if ( typeof frontendData === 'undefined' ) {
		queryParams.push( 'status=noCaptcha' );

		responseStatus = 404;
		responseObject = 'Not Found';
	} else {
		// If an image field name was submitted, try to validate it
		if ( ( imageAnswer = req.body[ frontendData.imageFieldName ] ) ) {
			if ( visualCaptcha.validateImage( imageAnswer ) ) {
				queryParams.push( 'status=validImage' );

				responseStatus = 200;
			} else {
				queryParams.push( 'status=failedImage' );

				responseStatus = 403;
			}
		} else if ( ( audioAnswer = req.body[ frontendData.audioFieldName ] ) ) {
			// We set lowercase to allow case-insensitivity, but it's actually optional
			if ( visualCaptcha.validateAudio( audioAnswer.toLowerCase() ) ) {
				queryParams.push( 'status=validAudio' );

				responseStatus = 200;
			} else {
				queryParams.push( 'status=failedAudio' );

				responseStatus = 403;
			}
		} else {
			queryParams.push( 'status=failedPost' );

			responseStatus = 500;
		}
	}

	if(responseStatus === 403) {
		newrelic.setIgnoreTransaction(true);
		setTimeout(function() {
			res.send( responseStatus );
		}, 2000);
	} else {
		req.session.ishuman = true;
		res.send( responseStatus );
	}
};

// Routes definition


app.post( '/captcha/try', _trySubmission );

// @param type is optional and defaults to 'mp3', but can also be 'ogg'
app.get( '/captcha/audio', _getAudio );
app.get( '/captcha/audio/:type', _getAudio );

// @param index is required, the index of the image you wish to get
app.get( '/captcha/image/:index', _getImage );

// @param howmany is required, the number of images to generate
app.get( '/captcha/start/:howmany', _startRoute );