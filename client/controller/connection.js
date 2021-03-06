import * as loop from './loop.js';
import * as view from '../view/index.js';
import * as model from '../model/index.js';

import * as entities from '../model/entities.js';
import * as message from '../../shared/message.js';


export default class Connection {
	constructor(slaveCo, lobbyId) {// a connection to a game server
		this.lastMessage;

		this.slaveCo = slaveCo;
		this.lobbyId = lobbyId;
		console.log('lobby id:', lobbyId);
		return new Promise((resolve, reject) => {
			slaveCo.createDataChannel('test', {
				ordered: false,
				maxRetransmits: 0, // unreliable
				protocol: 'JumpSuit'
			}).then(dc => {
				dc.binaryType = 'arraybuffer';

				dc.addEventListener('message', this.constructor.messageHandler.bind(this));
				dc.addEventListener('error', this.constructor.errorHandler);
				dc.addEventListener('close', this.constructor.closeHandler);

				this.fastDc = dc;

				this.sendMessage.call(this, message.connect, lobbyId, model.settings);

				this.latencyHandlerId = setInterval(this.constructor.latencyHandler.bind(this), 100);
				this.updateHandlerId = setInterval(this.constructor.updateHandler.bind(this), 50);

				resolve(this);
			}).catch(reject);
		});
	}
	alive() {
		return this.fastDc.readyState === 'open';
	}
	sendMessage(messageType, ...args) {
		this.fastDc.send(messageType.serialize.apply(messageType, args));
	}
	close() {
		clearInterval(this.latencyHandlerId);
		clearInterval(this.updateHandlerId);
		this.fastDc.removeEventListener('error', this.constructor.errorHandler);
		this.fastDc.removeEventListener('message', this.constructor.messageHandler);
		this.fastDc.removeEventListener('close', this.constructor.closeHandler);
		this.slaveCo.close();
	}
	setPreferences() {
		this.sendMessage(message.setPreferences, model.settings);
	}
	sendChat(content) {
		this.sendMessage(message.chat, content);
		view.chat.printChatMessage(entities.players[model.game.ownIdx].getFinalName(), entities.players[model.game.ownIdx].appearance, content);
	}
	refreshControls() {
		this.sendMessage(message.playerControls, model.controls.selfControls, model.controls.selfAngle);
	}
	static closeHandler() {
		view.history.push();
		view.dialogs.showDialog('Connection lost', 'Your connection to the game server was closed unexpectedly. Try to reconnect or join another server !');
	}
	static errorHandler(err) {
		view.history.push();
		console.error(err);
	}
	static updateHandler() {
		this.sendMessage(message.playerControls, model.controls.selfControls, model.controls.selfAngle);
	}
	static latencyHandler() {
		let latency = 0;
		if (this.lastMessage) {
			latency = Date.now() - this.lastMessage;
			if (latency > 7000) view.history.push();
			else if (latency > 2000) view.notif.showBadConnection();
			else view.notif.hideBadConnection();
		}
	}
	static messageHandler(msg) {
		this.lastMessage = Date.now();
		switch (message.getSerializator(msg.data)) {
			case message.error: {
				let errDesc;
				switch (message.error.deserialize(msg.data)) {
					case message.error.NO_LOBBY:
						errDesc = 'This lobby doesn\'t exist anymore';//TODO: show this message in a pop-up with 'See the other servers button' to get back to the menu
						break;
					case message.error.NO_SLOT:
						errDesc = 'There\'s no slot left in the lobby';
						break;
				}
				this.close();
				view.notif.showNotif('Couldn\' connect', errDesc);
				view.history.push();
				break;
			}
			case message.warmup: {
				model.entities.clean();

				let val = message.warmup.deserialize(msg.data,
					entities.addPlanet,
					entities.updatePlanet,
					entities.addEnemy,
					entities.updateEnemy,
					entities.addShot,
					entities.addPlayer,
					entities.updatePlayer
				);

				model.game.setState('warmup');
				model.game.setScores(val.scoresObj);
				view.hud.readyPointCounter(val.scoresObj);

				console.log('my ownIdx is:', val.playerId);
				model.game.setOwnIdx(val.playerId);
				entities.universe.width = val.univWidth;
				entities.universe.height = val.univHeight;

				if (view.history.getConnectionIds().serverId === null) view.history.push(this.slaveCo.id, val.lobbyId);

				view.views.closeMenu();
				view.hud.initMinimap();
				view.views.hideScores();
				view.hud.showWarmupStatus();

				loop.start();

				break;
			}
			case message.addEntity:
				message.addEntity.deserialize(msg.data,
					entities.addPlanet,
					entities.updatePlanet,
					entities.addEnemy,
					entities.updateEnemy,
					entities.addShot,
					entities.addPlayer,
					entities.updatePlayer
				);
				view.views.updatePlayerList();
				break;
			case message.removeEntity:
				message.removeEntity.deserialize(msg.data,
					id => {//remove planets
						console.log('TODO: implement planet removal', id);
					},
					id => {//remove enemies
						console.log('TODO: implement enemy removal', id);
					},
					id => {//remove shots
						entities.deadShots.push(entities.shots[id]);
						entities.deadShots[entities.deadShots.length - 1].lifeTime = 0;
						entities.shots.splice(id, 1);
					},
					id => {//remove players
						view.chat.printChatMessage(undefined, undefined, entities.players[id].getFinalName() + ' has left the game');
						console.log('We\'re gonna remove a player');
						delete entities.players[id];
					}
				);
				view.views.updatePlayerList();
				break;
			case message.gameState: {
				let val = message.gameState.deserialize(msg.data, entities.planets.length, entities.enemies.length,
					entities.updatePlanet,
					entities.updateEnemy,
					entities.updatePlayer
				);

				if (model.game.ownHealth !== val.yourHealth) {
					model.game.setOwnHealth(val.yourHealth);
					view.hud.updateHealth();
				}
				if (model.game.ownFuel !== val.yourFuel) {
					model.game.setOwnFuel(val.yourFuel);
					view.hud.updateFuel();
				}

				break;
			}
			case message.chatBroadcast: {
				let val = message.chatBroadcast.deserialize(msg.data);
				view.chat.printChatMessage(entities.players[val.id].getFinalName(), entities.players[val.id].appearance, val.message);
				break;
			}
			case message.setNameBroadcast: {
				let val = message.setNameBroadcast.deserialize(msg.data),
					oldName = entities.players[val.id].getFinalName();
				entities.players[val.id].name = val.name;
				entities.players[val.id].homographId = val.homographId;
				view.chat.printChatMessage(undefined, undefined, '"' + oldName + '" is now known as "' + entities.players[val.id].getFinalName() + '"');
				view.chat.printPlayerList();
				break;
			}
			case message.scores: {
				console.log('scores');
				let val = message.scores.deserialize(msg.data, model.game.scores);

				model.game.setScores(val);
				view.hud.updatePointCounter();

				if (model.game.state === 'warmup') {
					model.game.setState('playing');
					view.hud.hideWarmupStatus();
				}
				break;
			}
			case message.displayScores: {
				console.log('displayScores');
				view.views.showScores();
				loop.stop();
				model.entities.clean();
				model.controls.clean();
				break;
			}
		}
	}
}
