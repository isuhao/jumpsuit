"use strict";

var ownIdx = null,
	enabledTeams = [],
	masterSocket = new WebSocket("wss://" + location.hostname + (location.port === "" ? "" : ":" + location.port) + "/clients"),
	serverList,
	currentConnection;

const HISTORY_MENU = 0;
const HISTORY_GAME = 1;

masterSocket.binaryType = "arraybuffer";
masterSocket.addEventListener("message", message => {
	switch (new Uint8Array(message.data, 0, 1)[0]) {
		case MESSAGE.ADD_SERVERS.value:
			console.log("Got some new servers to add ! :D");
			if (serverList === undefined) {//first time data is inserted
				serverList = MESSAGE.ADD_SERVERS.deserialize(message.data);
				serverList.forEach(addServerRow);
				applyLobbySearch();//in case the page was refreshed and the
			} else {
				console.log(MESSAGE.ADD_SERVERS.deserialize(message.data), serverList);
				let newServers = MESSAGE.ADD_SERVERS.deserialize(message.data);
				serverList = serverList.concat(newServers);
				newServers.forEach(addServerRow);
			}
			break;
		case MESSAGE.REMOVE_SERVERS.value:
			console.log("I hafta remove servers :c");
			for (let id of MESSAGE.REMOVE_SERVERS.deserialize(message.data)) {
				removeServer(id);
			}
			break;
	}
});

function Connection(url, lobbyId) {// a connection to a game server
	this.lastControls = {};
	this.lastMessage;
	try {
		this.socket = new WebSocket(url);
	} catch (err) {
		showBlockedPortDialog(url.match(/:(\d+)/)[1]);
	}
	this.socket.binaryType = "arraybuffer";
	this.socket.addEventListener("open", () => {
		this.sendMessage.call(this, MESSAGE.CONNECT, lobbyId, settings);
	});
	this.socket.addEventListener("error", this.errorHandler);
	this.socket.addEventListener("message", this.messageHandler.bind(this));
	//this should return a Promise, dontcha think?

	this.latencyHandler = setInterval(() => {
		var param1 = document.getElementById("gui-bad-connection");
		if (Date.now() - this.lastMessage > 2000) param1.classList.remove("hidden");
		else param1.classList.add("hidden");

		if (this.lastMessage !== undefined && Date.now() - this.lastMessage > 7000) {
			currentConnection.close();
			game.stop();
		}
	}, 100);
}
Connection.prototype.alive = function() { return this.socket.readyState === 1; };
Connection.prototype.sendMessage = function(messageType, ...args) {
	try {
		this.socket.send(messageType.serialize.apply(messageType, args));
	} catch(err) {
		console.log(err);
		//TODO: display "connection lost" and get back to the main menu
		//or is that redudant with the event listener on "error"?
	}
};
Connection.prototype.createLobby = function(name, playerAmount) {
	if (!currentConnection.alive()) return;
	this.socket.send(MESSAGE.CREATE_LOBBY.serialize(name, playerAmount));
};
Connection.prototype.close = function() {
	clearInterval(this.latencyHandler);
	this.socket.close();
	this.socket.removeEventListener("error", this.errorHandler);
	this.socket.removeEventListener("message", this.messageHandler);
	game.stop();
//	history.pushState(HISTORY_MENU, "", "/");
	while (chatElement.childNodes.length > 1) chatElement.removeChild(chatElement.childNodes[1]);
};
Connection.prototype.setPreferences = function() {
	this.sendMessage(MESSAGE.SET_PREFERENCES, settings);
};
Connection.prototype.sendChat = function(content) {
	this.sendMessage(MESSAGE.CHAT, content);
	printChatMessage(players[ownIdx].getFinalName(), players[ownIdx].appearance, content);
};
Connection.prototype.refreshControls = function(controls) {
	var accordance = 0, b = 0; //checking if every entry is the same, if so no changes & nothing to send
	for (var c in players[ownIdx].controls) {
		b++;
		if (this.lastControls[c] === players[ownIdx].controls[c]) accordance++;
		else this.lastControls[c] = players[ownIdx].controls[c];
	}
	if (accordance === b) return;
	this.socket.send(MESSAGE.PLAYER_CONTROLS.serialize(controls));
};
Connection.prototype.sendMousePos = function(angle) {
	if (!currentConnection.alive()) return;
	if (this.lastAngle === undefined) this.lastAngle = 0;
	if (this.lastAngle !== angle) this.sendMessage(MESSAGE.AIM_ANGLE, angle);
	this.lastAngle = angle;
};
Connection.prototype.errorHandler = function() {
	//TODO: go back to main menu
	this.close();
};
Connection.prototype.messageHandler = function(message) {
	this.lastMessage = Date.now();
	switch (new Uint8Array(message.data, 0, 1)[0]) {
		case MESSAGE.ERROR.value:
			var errDesc;
			switch(MESSAGE.ERROR.deserialize(message.data)) {
				case MESSAGE.ERROR.NO_LOBBY:
					errDesc = "This lobby doesn't exist anymore";//TODO: show this message in a pop-up with "See the other servers button" to get back to the menu
					break;
				case MESSAGE.ERROR.NO_SLOT:
					errDesc = "There's no slot left in the lobby";
					break;
			}
			location.hash = "";
			alert("Error:\n" + errDesc);
			break;

		case MESSAGE.CONNECT_ACCEPTED.value:
			var val = MESSAGE.CONNECT_ACCEPTED.deserialize(message.data);
			planets.length = 0;
			enemies.length = 0;
			shots.length = 0;
			players.length = 0;

			ownIdx = val.playerId;
			universe.width = val.univWidth;
			universe.height = val.univHeight;

			var hashSocket = this.socket.url.replace(/^ws(s)?\:\/\/(.+)(:?\/)$/, "$1$2");

			location.hash = "#srv=" + hashSocket + "&lobby=" + encodeLobbyNumber(val.lobbyId);
			break;

		case MESSAGE.ADD_ENTITY.value:
			MESSAGE.ADD_ENTITY.deserialize(message.data,
				(x, y, radius, type) => {//add planets
					planets.push(new Planet(x, y, radius, type));
				},
				(x, y, appearance) => {//add enemies
					enemies.push(new Enemy(x, y, appearance));
				},
				(x, y, angle, origin, type) => {//add shots
					laserModel.makeSound(makePanner(x - players[ownIdx].box.center.x, y - players[ownIdx].box.center.y)).start(0);
					var shot = new Shot(x, y, angle, origin, type);
					shots.push(shot);
					var param1 = players.find(element => { return element !== null && element.pid === origin; });
					if (param1) param1.weaponry.muzzleFlash = type === shot.shotEnum.bullet || type === shot.shotEnum.ball;
				},
				(pid, x, y, attachedPlanet, angle, looksLeft, jetpack, appearance, walkFrame, name, homographId, armedWeapon, carriedWeapon) => {//add players
					console.log(pid);
					var newPlayer = new Player(name, appearance, walkFrame, attachedPlanet, jetpack, undefined, undefined, armedWeapon, carriedWeapon);
					newPlayer.pid = pid;
					newPlayer.box.center.x = x;
					newPlayer.box.center.y = y;
					newPlayer.looksLeft = looksLeft;
					newPlayer.homographId = homographId;
					printChatMessage(undefined, undefined, newPlayer.getFinalName() + " joined the game");
					players[pid] = newPlayer;
				}
			);
			break;
		case MESSAGE.REMOVE_ENTITY.value:
			MESSAGE.REMOVE_ENTITY.deserialize(message.data,
				id => {},//remove planets
				id => {},//remove enemies
				id => {//remove shots
					deadShots.push(shots[id]);
					deadShots[deadShots.length - 1].lifeTime = 0;
					shots.splice(id, 1);
				},
				id => {//remove players
					printChatMessage(undefined, undefined, players[id].getFinalName() + " has left the game");
					delete players[id];
				}
			);
			break;
		case MESSAGE.GAME_STATE.value: 
			var val = MESSAGE.GAME_STATE.deserialize(message.data, planets.length, enemies.length, players.length,
				(id, ownedBy, progress) => {
					planets[id].progress.team = ownedBy;
					planets[id].progress.value = progress;
					planets[id].updateColor();
				},
				(id, angle) => {
					enemies[id].box.angle = angle;
				},
				(pid, x, y, attachedPlanet, angle, looksLeft, jetpack, hurt, walkFrame, armedWeapon, carriedWeapon, aimAngle) => {
					if (pid === ownIdx) {
						if (!players[pid].jetpack && jetpack) {
							players[pid].jetpackSound = jetpackModel.makeSound(soundEffectGain, 1);
							players[pid].jetpackSound.start(0);
						} else if (players[pid].jetpack && !jetpack && players[ownIdx].jetpackSound !== undefined) {
							players[pid].jetpackSound.stop();
						}
					} else {
						if (!players[pid].jetpack && jetpack) {
							setPanner(players[pid].panner, players[pid].box.center.x - players[ownIdx].box.center.x, players[pid].box.center.y - players[ownIdx].box.center.y);
							players[pid].jetpackSound = jetpackModel.makeSound(players[pid].panner, 1);
							players[pid].jetpackSound.start(0);
						} else if(players[pid].jetpack && !jetpack && players[pid].jetpackSound !== undefined) {
							players[pid].jetpackSound.stop();
						}
					}
					var param1 = Date.now(), param2 = players[pid];

					if ("timestamp" in players[pid].predictionTarget) param1 = param2.predictionTarget.timestamp;
					players[pid].predictionTarget = {timestamp: Date.now(), box: new Rectangle(new Point(x, y), 0, 0, angle), aimAngle: aimAngle};
					players[pid].predictionBase = {timestamp: param1, box: new Rectangle(new Point(param2.box.center.x, param2.box.center.y), 0, 0, param2.box.angle), aimAngle: param2.aimAngle};
					players[pid].looksLeft = looksLeft;
					if ((players[pid].walkFrame === "_walk1" && walkFrame === "walk2") || (players[pid].walkFrame === "_walk2" && walkFrame === "walk1")) {
						let type = planets[players[pid].attachedPlanet].type,
							stepSound = stepModels[type][players[pid].lastSound].makeSound(makePanner(x - players[ownIdx].box.center.x, y - players[ownIdx].box.center.y));
						if (stepSound.buffer !== undefined) {
							stepSound.playbackRate.value = Math.random() + 0.5;//pitch is modified from 50% to 150%
						} else {//hack for Chrome (doesn't sound as good)
							stepSound.mediaElement.playbackRate = Math.random() + 0.5;
						}
						stepSound.start(0);
						players[pid].lastSound = (players[pid].lastSound + 1) % 5;
					}
					players[pid].walkFrame = "_" + walkFrame;
					players[pid].hurt = hurt;
					players[pid].jetpack = jetpack;

					players[pid].attachedPlanet = attachedPlanet;
					players[pid].weaponry.armed = armedWeapon;
					players[pid].weaponry.carrying = carriedWeapon;
				}
			);

			players[ownIdx].health = val.yourHealth;
			players[ownIdx].fuel = val.yourFuel;

			Array.prototype.forEach.call(document.querySelectorAll("#gui-health div"), (element, index) => {
				var state = "heartFilled";
				if (index * 2 + 2 <= players[ownIdx].health) state = "heartFilled";
				else if (index * 2 + 1 === players[ownIdx].health) state = "heartHalfFilled";
				else state = "heartNotFilled";
				element.className = state;
			});
			if (fuelElement.value !== val.yourFuel) fuelElement.value = val.yourFuel;

			break;

		case MESSAGE.CHAT_BROADCAST.value:
			var val = MESSAGE.CHAT_BROADCAST.deserialize(message.data);
			printChatMessage(players[val.id].getFinalName(), players[val.id].appearance, val.message);
			break;
		case MESSAGE.SET_NAME_BROADCAST.value:
			var val = MESSAGE.SET_NAME_BROADCAST.deserialize(message.data),
				oldName = players[val.id].getFinalName();
			players[val.id].name = val.name;
			players[val.id].homographId = val.homographId;
			printChatMessage(undefined, undefined, "\"" + oldName + "\" is now known as \"" + players[val.id].getFinalName() + "\"");
			printPlayerList();
			break;
		case MESSAGE.SCORES.value:
			var val = MESSAGE.SCORES.deserialize(message.data, enabledTeams);
			for (var team in val) {
				var element = document.getElementById("gui-points-" + team);
				if (element !== null) {
					element.textContent = val[team];
					element.style.display = "inline-block";
				}
			}
			break;
		case MESSAGE.LOBBY_STATE.value:
			var val = MESSAGE.LOBBY_STATE.deserialize(message.data);
			if (val.enabledTeams !== undefined) enabledTeams = val.enabledTeams;
			console.log(val);
			if (val.state === "PLAYING" && !game.started) game.start();
			else if (val.state === "DISPLAYING_SCORES") {
				if (game.started) game.stop();
				planets.length = 0;
				enemies.length = 0;
				shots.length = 0;
			}
			break;
	}
};


function connectByHash() {
	if (location.hash === "") return;
	try {
		let [, ip, lobbyId] = location.hash.match(/^#srv=(s?[\d\.:a-f]*)&lobby=([ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789\-\._~!$&'()\*\+,;=:@]+)/),
			protocol;
		if (ip.startsWith("s")) {
			protocol = "ws://";
			ip = ip.slice(1);
		} else protocol = "wss://";

		let url = protocol + ip + "/";

		if (currentConnection !== undefined) {
			if (currentConnection.socket.url !== url) {
				currentConnection.close();
				currentConnection = new Connection(url, lobbyId);
			} else if (!currentConnection.alive()) {
				currentConnection = new Connection(url, lobbyId);
			}
		} else currentConnection = new Connection(url, lobbyId);
	} catch (ex) {
		if (currentConnection !== undefined) currentConnection.close();
		console.log(ex, ex.stack);
	}
}

function handleHistoryState() {
	//modifies default history entries due hash changes
	if (location.hash !== "") history.replaceState(HISTORY_GAME, "", "/" + location.hash);
	else history.replaceState(HISTORY_MENU, "", "/");
	if (history.state === HISTORY_MENU) {
		//if navigated to / stop the game + display menu
		if (currentConnection !== undefined) currentConnection.close();
		game.stop();
	} else if (history.state === HISTORY_GAME) connectByHash();
}
window.addEventListener("popstate", handleHistoryState);

