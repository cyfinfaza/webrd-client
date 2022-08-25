<script>
	import {
		mqttConnect,
		BASE_TOPIC,
		clientID,
		connected,
		mqttConfig,
		mqttClient,
	} from "./lib/mqtt";
	import { onMount } from "svelte";
	import Paho from "paho-mqtt";

	import BooleanIndicator from "./components/BooleanIndicator.svelte";
	import Labeled from "./components/Labeled.svelte";

	/**@type {HTMLVideoElement}*/
	let desktopVideoElement;
	let desktopVideo = null;

	let viewerElement;

	let hosts = {};

	/** @type {RTCPeerConnection} */
	let pc;

	/** @type {RTCDataChannel} */
	let userInputChannel;

	let connectedTo = "";

	let wasFullScreen = window.innerHeight === screen.height;

	function disconnect() {
		console.log("WebRTC: Disconnecting from " + connectedTo);
		pc.close();
		mqttClient.send(BASE_TOPIC + "disconnect", clientID);
		if (!wasFullScreen) document.exitFullscreen();
		desktopVideo = new MediaStream();
		desktopVideoElement.srcObject = desktopVideo;
		connectedTo = "";
	}

	function onMessageArrived(message) {
		console.log("MQTT: Message arrived", message);
		const topic = message.destinationName.split("/");
		if (topic[1] === "advertise") {
			if (message.payloadBytes.byteLength > 0) {
				hosts[topic[2]] = JSON.parse(message.payloadString);
			} else {
				delete hosts[topic[2]];
				hosts = hosts;
				console.log(connectedTo, topic[2]);
				if (topic[2] === connectedTo) {
					disconnect();
				}
			}
		} else if (topic[3] === "answer") {
			const answer = JSON.parse(message.payloadString);
			console.log("WebRTC: Setting remote description", answer);
			pc.setRemoteDescription(answer);
		} else if (topic[3] === "iceCandidate") {
			const candidate = JSON.parse(message.payloadString);
			console.log("WebRTC: Received remote ICE candidate", candidate);
			pc.addIceCandidate(candidate);
		}
	}
	async function connectToHost(hostId) {
		connectedTo = hostId;
		wasFullScreen = window.innerHeight === screen.height;
		document.body.requestFullscreen();
		console.log("WebRTC: Connecting to host", hostId);
		pc = new RTCPeerConnection({
			iceServers: [
				{ urls: "stun:stun.l.google.com:19302" },
				{
					urls: "turn:numb.viagenie.ca",
					credential: "muazkh",
					username: "webrtc@live.com",
				},
			],
		});
		userInputChannel = pc.createDataChannel("userInput");
		userInputChannel.onopen = () => {
			console.log("WebRTC: User input channel open");
		};
		userInputChannel.onclose = () => {
			console.log("WebRTC: User input channel closed");
		};
		pc.onicecandidate = (e) => {
			console.log("WebRTC: Sending new local ICE candidate", e);
			mqttClient.send(
				BASE_TOPIC + "hosts/" + connectedTo + "/iceCandidate",
				JSON.stringify({ from: clientID, candidate: e.candidate })
			);
		};
		pc.ontrack = (e) => {
			if (!desktopVideo) desktopVideo = new MediaStream();
			console.log("WebRTC: Got track", e);
			desktopVideo.addTrack(e.track);
		};
		pc.onconnectionstatechange = (e) => {
			console.log("WebRTC: RTCPeerConnection state changed", e);
			console.log("WebRTC: Now " + pc.connectionState);
		};
		const offer = await pc.createOffer({ offerToReceiveVideo: true });
		console.log("WebRTC: Making offer", offer);
		await pc.setLocalDescription(offer);
		mqttClient.send(
			BASE_TOPIC + "hosts/" + connectedTo + "/offer",
			JSON.stringify({ from: clientID, sdp: offer })
		);
	}

	$: {
		if (desktopVideo && desktopVideoElement) {
			desktopVideoElement.srcObject = desktopVideo;
		}
	}

	if ($mqttConfig.autoConnect) {
		mqttConnect(onMessageArrived);
	}

	function userInputCallback(e) {
		e.preventDefault();
		// console.log(e.buttons);
		let x, y;
		if (
			desktopVideoElement.videoWidth / desktopVideoElement.videoHeight >
			window.innerWidth / window.innerHeight
		) {
			x = e.clientX / window.innerWidth;
			const videoHeight =
				(window.innerWidth * desktopVideoElement.videoHeight) /
				desktopVideoElement.videoWidth;
			y = (e.clientY - (window.innerHeight - videoHeight) / 2) / videoHeight;
		} else {
			const videoWidth =
				(window.innerHeight * desktopVideoElement.videoWidth) /
				desktopVideoElement.videoHeight;
			x = (e.clientX - (window.innerWidth - videoWidth) / 2) / videoWidth;
			y = e.clientY / window.innerHeight;
		}
		if (x > 0 && x < 1 && y > 0 && y < 1) {
			// console.log(x, y);
			console.log("WebRTC: Sending user input");
			userInputChannel.send(JSON.stringify({ x, y, buttons: e.buttons }));
		}
	}
</script>

<main class:hidden={connectedTo !== ""}>
	<div>
		<h1>WebRD</h1>
		<h3>{clientID}</h3>
		<p>
			MQTT: <BooleanIndicator
				state={$connected}
				trueMessage="Connected"
				falseMessage="Disconnected"
			/>
		</p>
		<p>
			Host: <BooleanIndicator
				state={connectedTo}
				trueMessage="Connected"
				falseMessage="Disconnected"
			/>
		</p>
	</div>
	<div>
		<h2>MQTT Config</h2>
		<div class="config">
			<Labeled label="Host: ">
				<input
					type="text"
					bind:value={$mqttConfig.host}
					placeholder="mq02.cy2.me"
				/>
			</Labeled>
			<Labeled label="Port: ">
				<input type="number" bind:value={$mqttConfig.port} placeholder="443" />
			</Labeled>
			<Labeled label="Basepath: ">
				<input
					type="text"
					bind:value={$mqttConfig.basepath}
					placeholder="/mqtt"
				/>
			</Labeled>
			<Labeled label="Use authentication? ">
				<input type="checkbox" bind:checked={$mqttConfig.useAuth} />
			</Labeled>
			{#if $mqttConfig.useAuth}
				<Labeled label="Username: ">
					<input
						type="text"
						bind:value={$mqttConfig.username}
						placeholder="admin"
					/>
				</Labeled>
				<Labeled label="Password: ">
					<input
						type="password"
						bind:value={$mqttConfig.password}
						placeholder="password"
					/>
				</Labeled>
			{/if}
			<Labeled label="Auto Connect? ">
				<input type="checkbox" bind:checked={$mqttConfig.autoConnect} />
			</Labeled>
			<button on:click={() => mqttConnect(onMessageArrived)}>Connect now</button
			>
		</div>
	</div>
	<div>
		<h2>Connect to host</h2>
		{#if Object.keys(hosts).length}
			{#each Object.keys(hosts) as host}
				<button on:click={() => connectToHost(host)}
					><strong>{hosts[host].name}</strong> ({host})</button
				>
			{/each}
		{:else}
			<p>No hosts found</p>
		{/if}
	</div>
</main>

<div class="viewer" class:active={connectedTo !== ""} bind:this={viewerElement}>
	<div class="controls">
		<span>
			Connected to: <strong>{hosts[connectedTo]?.name}</strong> ({connectedTo})
		</span>
		<button on:click={() => disconnect()}>Disconnect</button>
	</div>
	<video
		bind:this={desktopVideoElement}
		class="sendPreview"
		on:loadedmetadata={(e) => e.target.play()}
		on:mousemove={userInputCallback}
		on:keydown={userInputCallback}
		on:keyup={userInputCallback}
		on:mousedown={userInputCallback}
		on:mouseup={userInputCallback}
		on:contextmenu={(e) => e.preventDefault()}
	/>
</div>

<style lang="scss">
	main {
		width: 100%;
		max-width: 1000px;
		padding: 12px;
		gap: 24px;
		display: grid;
		grid-template-columns: 1fr 1fr 1fr;
		justify-items: center;
		align-items: center;
		box-sizing: border-box;
		transition: 240ms ease;

		&.hidden {
			pointer-events: none;
			transform: scale(1.2);
			opacity: 0;
		}
	}

	.viewer {
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		z-index: 1;
		background-color: #000;
		transition: 240ms ease;
		display: flex;
		justify-content: center;
		align-items: flex-end;

		video {
			width: 100%;
			height: 100%;
			object-fit: contain;
		}

		.controls {
			position: absolute;
			top: 0;
			display: flex;
			align-items: center;
			padding: 12px;
			border-bottom-left-radius: 12px;
			border-bottom-right-radius: 12px;
			gap: 12px;
			background: #111;
			z-index: 2;
			transition: 240ms ease;
			opacity: 0.5;
			transform: translateY(calc(-100% + 12px));
			&:hover {
				opacity: 1;
				transform: translateY(0);
			}
		}

		transform: scale(0.8);
		opacity: 0;
		pointer-events: none;
		&.active {
			pointer-events: all;
			transform: none;
			opacity: 1;
		}
	}
	.sendPreview {
		position: fixed;
		top: 0;
		left: 0;
		width: 300px;
	}
	.config {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 8px;
	}
</style>
