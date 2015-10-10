var lang = {};
GET('lang.json', function(response) {
	var strings = lang = JSON.parse(response);
	document.getElementById('username').placeholder = strings.username;
	document.getElementById('password').placeholder = strings.password;
	document.getElementById('repair').value = strings.repair;
	document.getElementById('contact').textContent = strings.contact;
	document.getElementById('explanation').textContent = strings.repairexplanation;
});

document.getElementById('container').addEventListener('submit', function(evt) {
	evt.preventDefault();
	
	document.getElementById('repair').disabled = true;
	document.getElementById('repair').value = lang.repairing;
	
	login({username: document.getElementById('username').value, password: document.getElementById('password').value}, null, function() {}, function() {
		JSZipUtils.getBinaryContent('/v2/current', function(err, data) {
			if(err) {
				document.getElementById('repair').disabled = false;
				document.getElementById('repair').value = lang.repair;
				alert(lang.error);
				return;
			}
			
			var zip = new JSZip(data);

			var getFile = function(file, options, callback) {
				if(!window.getFileCache[file] && file.substr(-1) !== '/' && zip.files[file.substr(1)]) {
					if(typeof options === 'function' || options === undefined) {
						callback = options;
						options = {};
					}
					var zipfile = zip.files[file.substr(1)];
					if(options.codec) {
						if(callback) callback(codec[options.codec].fromAB(zipfile.asArrayBuffer()));
						return;
					}
					if(callback) callback(zipfile.asText());
					return;
				}
				return _getFile(file, options, callback);
			};
			eval(zip.files['Core/core.js'].asText());
			var _getFile = window.getFile;
			window.getFile = getFile;

			var keys = Object.keys(zip.files);
			var target = '/';
			
			keys.forEach(function(path) {
				var file = zip.files[path];
				if(!file.options.dir) {
					putFile(
						target + path,
						{codec: 'arrayBuffer'},
						file.asArrayBuffer(),
						{from: 'origin'}  // Don't merge because the
										  // merge might've been the
										  // problem in the first place.
					);
				}
			});
			
			history.pushState({}, '', '/');
			getFile('/Core/startup.js', function(contents) {
				eval(contents);
				//alert(lang.repairdone.replace('{email}', '<a href="mailto:support@airbornos.com">support@airbornos.com</a>'));
			});
		});
	}, function(err) {
		document.getElementById('repair').disabled = false;
		document.getElementById('repair').value = lang.repair;
		alert(lang[err.id]);
	});
});