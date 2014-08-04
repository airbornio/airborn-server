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

function login(username, password) {
	GET('user/' + username + '/salt', function(salt) {
		var key = sjcl.misc.pbkdf2(password, sjcl.codec.hex.toBits(salt), 1000);
		var private_key = key.slice(128/32); // Second half
		var shared_key = key.slice(0, 128/32); // First half
		var private_hmac = window.private_hmac = new sjcl.misc.hmac(private_key);
		var shared_hmac = window.shared_hmac = new sjcl.misc.hmac(shared_key);
		GET('object/' + sjcl.codec.hex.fromBits(shared_hmac.mac(username).slice(0, 2)) + '/' + sjcl.codec.hex.fromBits(private_hmac.mac('/key')), function(response) {
			var files_key = window.files_key = sjcl.codec.hex.toBits(sjcl.decrypt(password, response));
			GET('object/' + sjcl.codec.hex.fromBits(shared_hmac.mac(username).slice(0, 2)) + '/' + sjcl.codec.hex.fromBits(private_hmac.mac('/Core/init.js')), function(response) {
				eval(sjcl.decrypt(files_key, response));
			});
		}, sjcl.codec.hex.fromBits(shared_key).toUpperCase());
	});
}

var username = sessionStorage.username || localStorage.username;
var password = sessionStorage.password || localStorage.password;
if(username && password) {
	
	// Login with previously saved credentials
	login(username, password);
	
} else {
	
	// Language strings
	GET('lang.json', function(response) {
		var strings = JSON.parse(response);
		document.getElementById('username').placeholder = strings.username;
		document.getElementById('password').placeholder = strings.password;
		document.getElementById('login').value = strings.login;
		document.getElementById('label').textContent = strings.save;
	});

	// Page content
	var iframe = document.createElement('iframe');
	if('sandbox' in iframe) {
		iframe.sandbox = true;
		iframe.src = 'content.html';
		iframe.id = 'content';
		document.documentElement.appendChild(iframe);
	}
	
	// Login handler
	document.getElementById('container').addEventListener('submit', function(evt) {
		evt.preventDefault();
		var username = document.getElementById('username').value;
		var password = document.getElementById('password').value;
		login(username, password);
		var storage = document.getElementById('save').checked ? localStorage : sessionStorage;
		storage.username = username;
		storage.password = password;
	}, false);
	
}