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

function login(creds, firstfile, requestmorecreds, success, error) {
	var username = creds.username;
	var password = creds.password;
	var key = creds.key;
	var files_key = creds.files_key;
	var hmac_bits = creds.hmac_bits;
	if(username && (key || password)) {
		GET('user/' + username + '/salt', function(salt) {
			var done = 0;
			var storage = {};
			storage.username = window.username = username;
			if(!key) {
				key = sjcl.misc.pbkdf2(password, sjcl.codec.hex.toBits(salt), 1000);
				storage.key = key;
			}
			var private_key = window.private_key = key.slice(128/32); // Second half
			var shared_key = key.slice(0, 128/32); // First half
			var private_hmac = window.private_hmac = new sjcl.misc.hmac(private_key);
			var files_hmac;
			var authkey = sjcl.codec.hex.fromBits(shared_key).toUpperCase();
			if(files_key && hmac_bits && firstfile) {
				window.files_key = files_key;
				files_hmac = window.files_hmac = new sjcl.misc.hmac(hmac_bits);
				cont(authkey);
			} else {
				GET('object/' + sjcl.codec.hex.fromBits(private_hmac.mac('/key')), function(response) {
					try {
						files_key = sjcl.codec.hex.toBits(sjcl.decrypt(private_key, response));
					} catch(e) {
						files_key = sjcl.codec.hex.toBits(sjcl.decrypt(password, response));
					}
					storage.files_key = window.files_key = files_key;
					if(++done === 2) cont();
				}, err, authkey);
				GET('object/' + sjcl.codec.hex.fromBits(private_hmac.mac('/hmac')), function(response) {
					try {
						hmac_bits = sjcl.codec.hex.toBits(sjcl.decrypt(private_key, response));
					} catch(e) {
						hmac_bits = sjcl.codec.hex.toBits(sjcl.decrypt(password, response));
					}
					storage.hmac_bits = hmac_bits;
					files_hmac = window.files_hmac = new sjcl.misc.hmac(hmac_bits);
					if(++done === 2) cont();
				}, undefined, authkey);
			}
			function cont(authkey) {
				function cont2() {
					var account_info = window.account_info = JSON.parse(decodeURIComponent(document.cookie.split('=')[1]).match(/\{.*\}/)[0]);
					var S3Prefix = window.S3Prefix = account_info.S3Prefix;
					var account_version = window.account_version = account_info.account_version;
					if(account_version === 1) {
						storage.password = window.password = password;
					}
				}
				if(firstfile) {
					GET('object/' + sjcl.codec.hex.fromBits(files_hmac.mac(firstfile)), function(response) {
						cont2();
						eval(sjcl.decrypt(files_key, response));
						success(storage);
					}, err, authkey);
				} else {
					cont2();
					success(storage);
				}
			}
			function err(req) {
				if(req.status === 401) {
					error({status: req.status, statusText: req.statusText, id: 'wrongpass'});
				} else {
					error({status: req.status, statusText: req.statusText, id: 'error'});
				}
			}
		}, function(req) {
			if(req.status === 404) {
				error({status: req.status, statusText: req.statusText, id: 'wronguser'});
			} else {
				error({status: req.status, statusText: req.statusText, id: 'error'});
			}
		});
	} else {
		error({status: 0, statusText: '', id: 'missingcreds'});
	}
}