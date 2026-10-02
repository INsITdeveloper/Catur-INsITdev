const ICE = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' }
    ]
};

export class VoiceChat {
    constructor(options) {
        this.selfId = options.selfId;
        this.send = options.send;
        this.onChange = options.onChange || (() => {});
        this.onError = options.onError || (() => {});
        this.localStream = null;
        this.peers = new Map();
        this.joined = false;
        this.muted = false;
        this.levels = new Map();
        this.audioContext = null;
        this.meterTimer = null;
    }

    get isJoined() {
        return this.joined;
    }

    async join() {
        if (this.joined) return true;
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                },
                video: false
            });
        } catch (err) {
            this.onError('Mikrofon tidak bisa diakses. Izinkan akses mikrofon di browser, lalu coba lagi.');
            return false;
        }
        this.joined = true;
        this.muted = false;
        this.audioContext = this.audioContext || new (window.AudioContext || window.webkitAudioContext)();
        if (this.audioContext.state === 'suspended') await this.audioContext.resume();
        this.send({ type: 'VOICE_JOIN', muted: false });
        this.startMeter();
        this.onChange();
        return true;
    }

    leave() {
        if (!this.joined && !this.localStream) return;
        for (const [id] of this.peers) this.dropPeer(id);
        this.peers.clear();
        if (this.localStream) {
            for (const track of this.localStream.getTracks()) track.stop();
            this.localStream = null;
        }
        this.joined = false;
        this.muted = false;
        this.levels.clear();
        if (this.meterTimer) clearInterval(this.meterTimer);
        this.meterTimer = null;
        this.send({ type: 'VOICE_LEAVE' });
        this.onChange();
    }

    setMuted(muted) {
        this.muted = Boolean(muted);
        if (this.localStream) {
            for (const track of this.localStream.getAudioTracks()) track.enabled = !this.muted;
        }
        this.send({ type: 'VOICE_MUTE', muted: this.muted });
        this.onChange();
    }

    toggleMute() {
        this.setMuted(!this.muted);
    }

    dropPeer(id) {
        const peer = this.peers.get(id);
        if (!peer) return;
        try {
            peer.pc.close();
        } catch {}
        if (peer.audio) peer.audio.remove();
        if (peer.analyser) {
            try { peer.analyser.disconnect(); } catch {}
        }
        this.peers.delete(id);
        this.levels.delete(id);
    }

    syncPeers(ids) {
        const wanted = new Set(ids.filter((id) => id !== this.selfId));
        for (const id of [...this.peers.keys()]) {
            if (!wanted.has(id)) this.dropPeer(id);
        }
        if (!this.joined) return;
        for (const id of wanted) this.ensurePeer(id);
    }

    ensurePeer(id) {
        let peer = this.peers.get(id);
        if (peer) return peer;
        const pc = new RTCPeerConnection(ICE);
        const audio = document.createElement('audio');
        audio.autoplay = true;
        audio.playsInline = true;
        audio.dataset.peer = id;
        document.body.appendChild(audio);
        peer = { pc, audio, analyser: null, source: null, polite: this.selfId < id, speaking: false };
        this.peers.set(id, peer);

        if (this.localStream) {
            for (const track of this.localStream.getTracks()) pc.addTrack(track, this.localStream);
        }

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.send({ type: 'VOICE_SIGNAL', to: id, kind: 'candidate', payload: event.candidate.toJSON() });
            }
        };

        pc.ontrack = (event) => {
            const stream = event.streams[0] || new MediaStream([event.track]);
            audio.srcObject = stream;
            audio.play().catch(() => {});
            this.attachAnalyser(id, stream);
        };

        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'failed') {
                this.dropPeer(id);
                if (this.joined) this.ensurePeer(id);
            }
        };

        if (!peer.polite) {
            pc.onnegotiationneeded = async () => {
                try {
                    await pc.setLocalDescription(await pc.createOffer());
                    this.send({ type: 'VOICE_SIGNAL', to: id, kind: 'offer', payload: pc.localDescription });
                } catch {}
            };
        }
        return peer;
    }

    attachAnalyser(id, stream) {
        if (!this.audioContext) return;
        const peer = this.peers.get(id);
        if (!peer) return;
        try {
            const source = this.audioContext.createMediaStreamSource(stream);
            const analyser = this.audioContext.createAnalyser();
            analyser.fftSize = 512;
            analyser.smoothingTimeConstant = 0.6;
            source.connect(analyser);
            peer.source = source;
            peer.analyser = analyser;
        } catch {}
    }

    startMeter() {
        if (this.meterTimer) return;
        this.meterTimer = setInterval(() => {
            let changed = false;
            for (const [id, peer] of this.peers) {
                if (!peer.analyser) continue;
                const data = new Uint8Array(peer.analyser.frequencyBinCount);
                peer.analyser.getByteFrequencyData(data);
                let sum = 0;
                for (const v of data) sum += v * v;
                const rms = Math.sqrt(sum / data.length) / 255;
                const speaking = rms > 0.06;
                const held = this.levels.get(id) || { speaking: false, until: 0 };
                const until = speaking ? Date.now() + 420 : held.until;
                const next = speaking || Date.now() < until;
                this.levels.set(id, { speaking: next, until });
                if (next !== held.speaking) changed = true;
            }
            if (changed) this.onChange();
        }, 220);
    }

    speakingSet() {
        const out = new Set();
        for (const [id, level] of this.levels) {
            if (level.speaking) out.add(id);
        }
        return out;
    }

    async handleSignal(from, kind, payload) {
        if (!this.joined) return;
        const peer = this.ensurePeer(from);
        const pc = peer.pc;
        try {
            if (kind === 'offer') {
                const offerCollision = pc.signalingState !== 'stable';
                if (offerCollision && !peer.polite) return;
                if (offerCollision) await pc.setLocalDescription({ type: 'rollback' }).catch(() => {});
                await pc.setRemoteDescription(payload);
                await pc.setLocalDescription(await pc.createAnswer());
                this.send({ type: 'VOICE_SIGNAL', to: from, kind: 'answer', payload: pc.localDescription });
            } else if (kind === 'answer') {
                if (pc.signalingState === 'have-local-offer') {
                    await pc.setRemoteDescription(payload);
                }
            } else if (kind === 'candidate') {
                try {
                    await pc.addIceCandidate(payload);
                } catch {}
            }
        } catch (err) {
            console.warn('sinyal suara gagal', err);
        }
    }
}
