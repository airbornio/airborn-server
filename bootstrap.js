// First try to login with previously saved credentials
login(JSON.parse(localStorage.creds || sessionStorage.creds || '{}'), '/Core/init.js', function() {}, function() {}, buildLoginForm);

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
		iframe.sandbox = 'allow-top-navigation';
		iframe.src = 'content';
		iframe.id = 'content';
		iframe.scrolling = 'no';
		document.body.appendChild(iframe);
	}
	
	// Login handler
	document.getElementById('container').addEventListener('submit', function(evt) {
		evt.preventDefault();
		var storage = document.getElementById('save').checked ? localStorage : sessionStorage;
		var username = document.getElementById('username').value;
		var password = document.getElementById('password').value;
		login({username: username, password: password}, '/Core/init.js', function() {}, function(storecreds) {
			storage.creds = JSON.stringify(storecreds);
		}, function(err) {
			alert(lang[err.id]);
		});
	});
	
}