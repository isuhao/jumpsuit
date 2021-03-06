const lobbyListElement = document.getElementById('lobby-list');

export let slaveRows = new Map();
export function addServerRow(slaveCo) {
	let row = document.createElement('tr'),
		serverNameTd = document.createElement('td'),
		modNameTd = document.createElement('td'),
		buttonTd = document.createElement('td'),
		button = document.createElement('button');

	serverNameTd.textContent = slaveCo.userData.serverName;
	modNameTd.textContent = slaveCo.userData.modName;

	button.textContent = 'Play!';
	button.slaveCo = slaveCo;

	buttonTd.appendChild(button);
	row.appendChild(serverNameTd);
	row.appendChild(modNameTd);
	row.appendChild(buttonTd);

	lobbyListElement.insertBefore(row, lobbyListElement.firstChild);

	slaveRows.set(slaveCo, row);
}
export function removeServer(slaveCo) {
	slaveRows.get(slaveCo).remove();
	slaveRows.delete(slaveCo);
}

export function bindPlay(handler) {
	lobbyListElement.addEventListener('click', e => {
		if (e.target.tagName === 'BUTTON') {
			handler(e.target.slaveCo);
		}
	});
}
