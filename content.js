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

GET('lang.json', function(response) {
	var strings = JSON.parse(response);
	document.getElementById('register').textContent = strings.register;
});