var req = new XMLHttpRequest();
req.onreadystatechange = function() {
	if(req.readyState === 4 && req.status === 200) {
		eval(req.responseText);
	}
};
req.open('GET', 'init.js');
req.send(null);