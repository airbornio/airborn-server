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

function decryptAndMaybeUngzip(key, contents) {
	var outparams = {};
	var decrypted = sjcl.decrypt(key, contents, {raw: 1}, outparams);
	if(outparams.adata.length) {
		decrypted = pako.ungzip(new Uint8Array(sjcl.codec.arrayBuffer.fromBits(decrypted)), {to: 'string'});
		/* arrayBuffer.fromBits adds padding by default, but that's allowed for gzip files. */
	} else {
		decrypted = sjcl.codec.utf8String.fromBits(decrypted);
	}
	return decrypted;
}

function login(creds, firstfile, requestmorecreds, success, error) {
	var username = creds.username;
	var password = creds.password;
	var key = creds.key;
	var files_key = creds.files_key;
	var hmac_bits = creds.hmac_bits;
	var authkey;
	var storage = {};
	if(username && (key || password)) {
		new Promise(function(resolve, reject) {
			GET('user/' + username + '/salt', function(salt) {
				creds.salt = salt = sjcl.codec.hex.toBits(salt);
				resolve(salt);
			}, reject);
		}).then(function(salt) {
			storage.username = window.username = username;
			if(!key) {
				key = sjcl.misc.pbkdf2(password, salt, 1000);
				storage.key = key;
			}
			window.private_key = key.slice(128/32); // Second half
			var shared_key = key.slice(0, 128/32); // First half
			window.private_hmac = new sjcl.misc.hmac(window.private_key);
			authkey = sjcl.codec.hex.fromBits(shared_key).toUpperCase();
			
			return Promise.all([
				firstfile && files_key || new Promise(function(resolve, reject) {
					GET('object/' + sjcl.codec.hex.fromBits(window.private_hmac.mac('/key')), function(response) {
						try {
							files_key = decryptAndMaybeUngzip(window.private_key, response);
						} catch(e) {
							files_key = decryptAndMaybeUngzip(password, response);
						}
						storage.files_key = files_key = sjcl.codec.hex.toBits(files_key);
						resolve();
					}, reject, authkey);
				}),
				hmac_bits || new Promise(function(resolve, reject) {
					GET('object/' + sjcl.codec.hex.fromBits(window.private_hmac.mac('/hmac')), function(response) {
						try {
							hmac_bits = decryptAndMaybeUngzip(window.private_key, response);
						} catch(e) {
							hmac_bits = decryptAndMaybeUngzip(password, response);
						}
						storage.hmac_bits = hmac_bits = sjcl.codec.hex.toBits(hmac_bits);
						resolve();
					}, reject, authkey);
				})
			]);
		}).then(function() {
			window.files_key = files_key;
			window.files_hmac = new sjcl.misc.hmac(hmac_bits);
			
			if(firstfile) {
				return new Promise(function(resolve, reject) {
					GET('object/' + sjcl.codec.hex.fromBits(window.files_hmac.mac(firstfile)), function(response) {
						resolve(decryptAndMaybeUngzip(files_key, response))
					}, reject, authkey);
				});
			}
		}).then(function(firstfilecontents) {
			window.account_info = JSON.parse(decodeURIComponent(document.cookie.split('=')[1]).match(/\{.*\}/)[0]);
			window.S3Prefix = window.account_info.S3Prefix;
			window.account_version = window.account_info.account_version;
			if(window.account_version === 1) {
				storage.password = window.password = password;
			}
			if(firstfile) {
				eval(firstfilecontents);
			}
			success(storage);
		}).catch(function(req) {
			if(req.status === 401) {
				error({status: req.status, statusText: req.statusText, id: 'wrongpass'});
			} else if(req.status === 404) {
				error({status: req.status, statusText: req.statusText, id: 'wronguser'});
			} else {
				error({status: req.status, statusText: req.statusText, id: 'error'});
			}
		});
	} else {
		error({status: 0, statusText: '', id: 'missingcreds'});
	}
}