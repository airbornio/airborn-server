function GET(url, callback, err, authkey) {
	var req = new XMLHttpRequest();
	req.onreadystatechange = function() {
		if(req.readyState === 4) {
			if(req.status === 200) {
				callback(req.responseText);
			} else {
				if(err) err(req);
			}
		}
	};
	req.open('GET', url);
	if(authkey) req.setRequestHeader('X-Authentication', authkey);
	req.send(null);
}

function login(username, password, key, files_key, hmac_bits, errcallback) {
	GET('user/' + username + '/salt', function(salt) {
		var done = 0;
		if(!key) {
			key = sjcl.misc.pbkdf2(password, sjcl.codec.hex.toBits(salt), 1000);
			(localStorage.username ? localStorage : sessionStorage)._key = JSON.stringify(key); // Storage#key is a function.
		}
		var private_key = window.private_key = key.slice(128/32); // Second half
		var shared_key = key.slice(0, 128/32); // First half
		var private_hmac = window.private_hmac = new sjcl.misc.hmac(private_key);
		var files_hmac;
		var authkey = sjcl.codec.hex.fromBits(shared_key).toUpperCase();
		if(files_key && hmac_bits) {
			files_hmac = window.files_hmac = new sjcl.misc.hmac(hmac_bits);
			cont(authkey);
		} else {
			GET('object/' + sjcl.codec.hex.fromBits(private_hmac.mac('/key')), function(response) {
				try {
					files_key = window.files_key = sjcl.codec.hex.toBits(sjcl.decrypt(private_key, response));
				} catch(e) {
					files_key = window.files_key = sjcl.codec.hex.toBits(sjcl.decrypt(password, response));
				}
				window.storage.files_key = JSON.stringify(files_key);
				if(++done === 2) cont();
			}, errcallback || err, authkey);
			GET('object/' + sjcl.codec.hex.fromBits(private_hmac.mac('/hmac')), function(response) {
				try {
					var hmac_bits = sjcl.codec.hex.toBits(sjcl.decrypt(private_key, response));
				} catch(e) {
					var hmac_bits = sjcl.codec.hex.toBits(sjcl.decrypt(password, response));
				}
				window.storage.hmac_bits = JSON.stringify(hmac_bits);
				files_hmac = window.files_hmac = new sjcl.misc.hmac(hmac_bits);
				if(++done === 2) cont();
			}, undefined, authkey);
		}
		function cont(authkey) {
			GET('object/' + sjcl.codec.hex.fromBits(files_hmac.mac('/Core/init.js')), function(response) {
				var account_info = JSON.parse(decodeURIComponent(document.cookie.split('=')[1]).match(/\{.*\}/)[0]);
				var S3Prefix = window.S3Prefix = account_info.S3Prefix;
				var account_version = window.account_version = account_info.account_version;
				if(account_version === 1) {
					window.password = (window.storage || {}).password = password;
				}
				eval(sjcl.decrypt(files_key, response));
			}, errcallback || err, authkey);
		}
		function err(req) {
			if(req.status === 401) {
				alert(lang.wrongpass);
			} else {
				alert(lang.error);
			}
		}
	}, errcallback || function(req) {
		if(req.status === 404) {
			alert(lang.wronguser);
		} else {
			alert(lang.error);
		}
	});
}

var username = sessionStorage.username || localStorage.username;
var password = sessionStorage.password || localStorage.password;
var key = sessionStorage._key || localStorage._key;
if(key) key = JSON.parse(key);
var files_key = sessionStorage.files_key || localStorage.files_key;
if(files_key) files_key = JSON.parse(files_key);
var hmac_bits = sessionStorage.hmac_bits || localStorage.hmac_bits;
if(hmac_bits) hmac_bits = JSON.parse(hmac_bits);
if(username && (key || password) && files_key && hmac_bits) {
	
	// Login with previously saved credentials
	login(username, password, key, files_key, hmac_bits, buildLoginForm);
	
} else {
	
	buildLoginForm();
	
}

var lang = {};
function buildLoginForm() {
	
	// Language strings
	GET('lang.json', function(response) {
		var strings = lang = JSON.parse(response);
		document.getElementById('username').placeholder = strings.username;
		document.getElementById('password').placeholder = strings.password;
		document.getElementById('login').value = strings.login;
		document.getElementById('label').textContent = strings.save;
	});

	// Page content
	var iframe = document.createElement('iframe');
	if('sandbox' in iframe) {
		iframe.sandbox = 'allow-popups allow-same-origin';
		iframe.src = 'content';
		iframe.id = 'content';
		document.body.insertBefore(iframe, document.body.firstChild);
	}
	
	// Login handler
	document.getElementById('container').addEventListener('submit', function(evt) {
		evt.preventDefault();
		var storage = window.storage = document.getElementById('save').checked ? localStorage : sessionStorage;
		username = storage.username = document.getElementById('username').value;
		var password = document.getElementById('password').value;
		login(username, password);
	});
	
}