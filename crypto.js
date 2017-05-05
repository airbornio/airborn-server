var subtle = window.crypto.subtle || window.crypto.webkitSubtle;

function deriveKey(password, salt, rounds) {
	try {
		return subtle.importKey(
			'raw',
			sjcl.codec.arrayBuffer.fromBits(sjcl.codec.utf8String.toBits(password)),
			{
				name: 'PBKDF2',
			},
			false,
			['deriveBits']
		).then(function(key) {
			return subtle.deriveBits(
				{
					name: 'PBKDF2',
					salt: sjcl.codec.arrayBuffer.fromBits(salt),
					iterations: rounds,
					hash: {name: 'SHA-256'},
				},
				key,
				256
			);
		}).then(function(key) {
			return sjcl.codec.arrayBuffer.toBits(key);
		}).catch(error);
	} catch(e) {
		return error();
	}
	function error() {
		return Promise.resolve(sjcl.misc.pbkdf2(password, salt, rounds));
	}
}