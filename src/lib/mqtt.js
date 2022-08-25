import Paho from "paho-mqtt";
import { writable, get } from "svelte/store";

export const clientID = "webrd-client-" + parseInt(Math.random() * 10000000);

export const BASE_TOPIC = "webrd/";

export const connected = writable(false);
export const mqttConfig = writable(
	JSON.parse(window.localStorage.getItem("mqttConfig") || "{}")
);
mqttConfig.subscribe((config) => {
	window.localStorage.setItem("mqttConfig", JSON.stringify(config));
});

export let mqttClient;

/**
 *
 * @param {function} onMessageArrived
 * @returns {Paho.Client}
 */
export function mqttConnect(onMessageArrived) {
	return new Promise((resolve, reject) => {
		console.log("MQTT: Connecting as " + clientID);
		try {
			mqttClient.disconnect();
		} catch (e) {
			console.log(e);
		}
		const config = get(mqttConfig);
		mqttClient = new Paho.Client(
			config.host || "mq02.cy2.me",
			config.port || 443,
			config.basepath || "/mqtt",
			clientID
		);
		let willMessage = new Paho.Message(clientID);
		willMessage.destinationName = BASE_TOPIC + "disconnect";
		mqttClient.onMessageArrived = onMessageArrived;
		mqttClient.onConnectionLost = onFailure;
		/** @type {Paho.ConnectionOptions} */
		const connectionOptions = {
			onSuccess: onConnect,
			onFailure: onFailure,
			useSSL: true,
			willMessage: willMessage,
			keepAliveInterval: 5,
			reconnect: true,
			// mqttVersion: 3,
			// uris: ["wss://mq03.cy2.me/mqtt"],
		};
		if (config.useAuth ?? false) {
			connectionOptions.userName = config.username;
			connectionOptions.password = config.password;
		} else {
			delete connectionOptions.userName;
			delete connectionOptions.password;
		}
		mqttClient.connect(connectionOptions);
		function onFailure(e) {
			console.error("MQTT: Connection failed", e);
			connected.update((_) => false);
			// setTimeout(() => {
			// 	client.connect(connectionOptions);
			// }, 2000);
		}
		function onConnect() {
			mqttClient.subscribe(BASE_TOPIC + "clients/" + clientID + "/#");
			mqttClient.subscribe(BASE_TOPIC + "advertise/#");
			console.log("MQTT: Connected as " + clientID);
			connected.update((_) => true);
			resolve(mqttClient);
		}
	});
}
