function GET(url, callback, authkey) {
	var req = new XMLHttpRequest();
	req.onreadystatechange = function() {
		if(req.readyState === 4 && req.status === 200) {
			callback(req.responseText);
		}
	};
	req.open('GET', url);
	if(authkey) req.setRequestHeader('X-Authentication', authkey);
	req.send(null);
}

// Language strings
GET('lang.json', function(response) {
	var strings = JSON.parse(response);
	document.getElementById('username').placeholder = strings.username;
	document.getElementById('password').placeholder = strings.password;
	document.getElementById('login').textContent = strings.login;
});

// Page content
var iframe = document.createElement('iframe');
if('sandbox' in iframe) {
	iframe.sandbox = true;
	iframe.src = 'content.html';
	document.documentElement.appendChild(iframe);
}

// Login handler
document.getElementById('login').addEventListener('click', login);
document.getElementById('password').addEventListener('keypress', function(evt) {
	if(evt.keyCode === 13) login();
});
function login() {
	var username = document.getElementById('username').value;
	var password = document.getElementById('password').value;
	GET('user/' + username + '/salt', function(salt) {
		var key = sjcl.misc.pbkdf2(password, sjcl.codec.hex.toBits(salt), 1000);
		var hmac = new sjcl.misc.hmac(key.slice(128/32));
		GET('object/' + sjcl.codec.hex.fromBits(hmac.mac('/init.js')) + '-c-' + sjcl.codec.hex.fromBits(hmac.mac('daniel-main').slice(0, 2)), function(response) {
			eval(sjcl.decrypt(password, response));
		}, sjcl.codec.hex.fromBits(key.slice(0, 128/32)).toUpperCase());
	});
}