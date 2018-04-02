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

var lang = {};
GET('lang.json', function(response) {
	var strings = lang = JSON.parse(response);
	document.getElementById('donate-label').textContent = strings.donate;
	document.getElementById('include-fee-label').textContent = strings['include-fee'];
	document.getElementById('donate-total-label').textContent = strings['donate-total'];
});

function onInput() {
	const baseDonation = document.getElementById('donation').valueAsNumber;
	const donation = document.getElementById('include-fee').checked ?
		Math.max(baseDonation / (1 - 0.089), baseDonation + 0.75 * exchangerate) :
		baseDonation;
	console.log(Math.max(0.75 * exchangerate, 0.089 * donation), donation - baseDonation);
	document.getElementById('donationtags').value = 'donation=' + Math.round(donation * 100);
	document.getElementById('donate-total').textContent = donation.toLocaleString(user_language, {style: 'currency', currency: user_currency});
}
document.getElementById('donation').addEventListener('input', onInput);
document.getElementById('include-fee').addEventListener('click', onInput);
onInput();