import * as view from '../view/index.js';

import Connection from './connection.js';

export let masterSocket = new MasterConnection((location.protocol === 'http:' ? 'ws://' : 'wss://') + location.hostname + (location.port === '' ? '' : ':' + location.port));
masterSocket.addEventListener('slaveadded', slaveCo => {
	view.servers.addServerRow(slaveCo);
	//TODO: view.applyLobbySearch();//in case the page was refreshed
});
masterSocket.addEventListener('slaveremoved', slaveCo => {
	view.servers.removeServer(slaveCo);
});

export var currentConnection;

export function makeNewCurrentConnection(slaveCo, id) {
	if (currentConnection !== undefined && currentConnection.alive()) currentConnection.close();
	new Connection(slaveCo, id).then((connection) => {
		currentConnection = connection;
	}).catch((err) => {
		view.dialogs.showDialog('Couldn\'t create connection', err.messsage);
		console.error(err);
	});
}
