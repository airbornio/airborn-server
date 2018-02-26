function GET(url, callback) {
	var req = new XMLHttpRequest();
	req.onreadystatechange = function() {
		if(req.readyState === 4 && req.status === 200) {
			callback(req.responseText);
		}
	};
	req.open('GET', url);
	req.send(null);
}

function POST(url, data, success, error) {
	var req = new XMLHttpRequest();
	req.onreadystatechange = function() {
		if(req.readyState === 4)
			if(req.status === 200) {
				success(req.responseText);
			} else {
				error(req);
			}
	};
	req.open('POST', url);
	req.setRequestHeader('Content-Type', 'application/json');
	req.send(JSON.stringify(data));
}

var lang = {};
GET('lang.json', function(response) {
	var strings = lang = JSON.parse(response);
	document.getElementById('username-label').textContent = strings.username;
	document.getElementById('current-password-label').textContent = strings['current-password'];
	document.getElementById('new-password-label').textContent = strings['new-password'];
	document.getElementById('new-password-again-label').textContent = strings['new-password-again'];
	document.getElementById('changepass').value = strings.changepass;
});

document.getElementById('container').addEventListener('submit', function(evt) {
	evt.preventDefault();
	var username = document.getElementById('username').value;
	var currentPassword = document.getElementById('current-password').value;
	var newPassword = document.getElementById('new-password').value;
	var newPasswordAgain = document.getElementById('new-password-again').value;
	if(newPassword !== newPasswordAgain) {
		alert(lang.diffpasswords);
		return;
	}
	
	login({username: username, password: currentPassword}, '/Core/modules/core/core.js', function() {}, function(storage) {
		// Backup files key+hmac with old private key+hmac
		putFile('/key.backup', sjcl.codec.hex.fromBits(storage.files_key).toUpperCase());
		putFile('/hmac.backup', sjcl.codec.hex.fromBits(storage.hmac_bits).toUpperCase());
		
		// Derive new key
		try {
			var salt = sjcl.random.randomWords(2);
		} catch(e) {
			console.error(e);
			alert(lang.error);
			throw e;
		}
		deriveKey(newPassword, salt, 1000).then(function(key) {
			// Update private key+hmac
			var private_key = window.private_key = key.slice(128/32); // Second half
			var shared_key = key.slice(0, 128/32); // First half
			var private_hmac = window.private_hmac = new sjcl.misc.hmac(private_key);
			var authkey = sjcl.codec.hex.fromBits(shared_key).toUpperCase();
						
			// Store files key+hmac with new private key+hmac
			putFile('/key', sjcl.codec.hex.fromBits(storage.files_key).toUpperCase());
			putFile('/hmac', sjcl.codec.hex.fromBits(storage.hmac_bits).toUpperCase(), function(err) {
				if(err) {
					console.error(err);
					alert(lang.error);
					return;
				}
				
				// Create new password backup file
				var password_backup_key = sjcl.random.randomWords(8);
				var password_backup = sjcl.encrypt(password_backup_key, newPassword);
				saveAs(new Blob([username, '\n', password_backup], {type: 'text/plain'}), 'airbornos.txt');
				
				// Send new authkey to server
				POST('/changepass', {
					salt: sjcl.codec.hex.fromBits(salt).toUpperCase(),
					authkey: authkey,
					password_backup_key: sjcl.codec.hex.fromBits(password_backup_key).toUpperCase(),
				}, function(response) {
					document.getElementById('container').textContent = lang.changedpass;
				}, function(req) {
					console.error(req);
					alert(lang.error);
				});
			});
		});
	}, function(err) {
		alert(lang[err.id]);
	});
});