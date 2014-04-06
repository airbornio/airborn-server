var fs = require('fs');
var path = require('path');

var express = require('express');
var app = express();

var pg = require('pg.js');

app.use(express.cookieParser());
app.use(express.cookieSession({secret: 'secret'})); // TODO: Hide secret

app.get('/', function(req, res) {
	res.sendfile('bootstrap.html');
});
app.get('/sjcl.js', function(req, res) {
	res.sendfile('sjcl.js');
});
app.get('/bootstrap.js', function(req, res) {
	res.sendfile('bootstrap.js');
});
app.get('/lang.json', function(req, res) {
	res.sendfile('lang.json');
});
app.get('/bootstrap.css', function(req, res) {
	res.sendfile('bootstrap.css');
});
app.get('/content.html', function(req, res) {
	res.sendfile('content.html');
});
app.get('/content.css', function(req, res) {
	res.sendfile('content.css');
});

app.get('/user/:username/salt', function(req, res) {
	pg.connect(process.env.DATABASE_URL, function(err, client, done) {
		if(err) {
			console.error(err);
			res.send(500);
			return;
		}
		client.query('SELECT salt FROM users WHERE username = $1', [req.route.params.username], function(err, result) {
			done();
			if(err) {
				console.error(err);
				res.send(500);
				return;
			}
			res.send(200, result.rows[0].salt);
		});
	});
});

app.get('/object/:id', function(req, res) {
	if(!userLoggedIn(req)) {
		res.send(403);
		return;
	}
	var path = objPath(req);
	res.attachment(path);
	res.sendfile(path);
});
app.put('/object/:id', function(req, res) {
	if(!userLoggedIn(req)) {
		res.send(403);
		return;
	}
	var path = objPath(req);
	var dest = fs.createWriteStream(path, {
		flags: 'w'
	});
	dest.on('error', function(err) {
		console.error(err.stack);
		res.send(500);
	});
	req.pipe(dest);
	req.on('end', function() {
		console.log(process.env.DATABASE_URL);
		pg.connect(process.env.DATABASE_URL, function(err, client, done) {
			if(err) {
				console.error(err);
				res.send(500);
				return;
			}
			client.query('INSERT INTO objects (ID, userID, metadata) VALUES ($1, $2, $3)', [req.route.params.id, userID, req.get('X-Object-Metadata')], function() {
				done();
				if(err) {
					console.error(err);
					res.send(500);
					return;
				}
				res.send(200);
			});
		});
	});
});

var server = app.listen(process.env.PORT || 8080, function() {
    console.log('Listening on port %d', server.address().port);
});

function objPath(req) {
	return path.join(__dirname, 'object', req.route.params.id);
}

function userLoggedIn(req) {
	return true;
	return req.session.username !== undefined;
}