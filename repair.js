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
		JSZipUtils.getBinaryContent('http://airborn-update-stage.herokuapp.com/v2/current', function(err, data) {
			if(err) {
				document.getElementById('repair').disabled = false;
				document.getElementById('repair').value = lang.repair;
				alert(lang.error);
				return;
			}
			
			var zip = new JSZip(data);

			var getFile = function(file, options, callback) {
				console.log([].slice.call(arguments));
				if(file.substr(-1) !== '/' && zip.files[file.substr(1)]) {
					if(typeof options === 'function') {
						callback = options;
						options = {};
					}
					callback(zip.files[file.substr(1)].asText());
					return;
				}
				return window.getFile(file, options, callback);
			};
			var openWindow = function() {};
			eval(zip.files['Core/core.js'].asText());

			var keys = Object.keys(zip.files);
			var uploaded = 0;
			var total = 0;
			var target = '/';
			
			keys.forEach(function(path) {
				var file = zip.files[path];
				if(!file.options.dir) {
					total++;
					putFile(
						target + path,
						{codec: 'arrayBuffer'},
						file.asArrayBuffer(),
						{from: 'origin'}, // Don't merge because the
										  // merge might've been the
										  // problem in the first place.
						function() {
							uploaded++;
							if(uploaded === total) cont();
						}
					);
				}
			});
			
			function cont() {
				document.getElementById('container').innerHTML = lang.repairdone.replace('{email}', '<a href="mailto:support@airbornos.com">support@airbornos.com</a>') + ' ' + '<a href="/">' + lang.login + '</a>';
			}
		});
	}, function(err) {
		document.getElementById('repair').disabled = false;
		document.getElementById('repair').value = lang.repair;
		alert(lang[err.id]);
	});
});