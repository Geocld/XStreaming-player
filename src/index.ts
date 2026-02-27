// import DebugChannel from './Channel/Debug'
import InputChannel from './Channel/Input'
import ControlChannel from './Channel/Control'
import MessageChannel from './Channel/Message'
import ChatChannel from './Channel/Chat'

import VideoComponent from './Component/Video'
import AudioComponent from './Component/Audio'

import EventBus from './Helper/EventBus'

import GamepadDriver from './Driver/Gamepad'
import KeyboardDriver, {MouseKeyboardConfig} from './Driver/Keyboard'

globalThis._lastStat = null
interface xStreamingPlayerConfig {
    ui_systemui?:Array<number>; // Default: [10,19,31,27,32,33]
    ui_version?:Array<number>; // Default: [0,1,0]
    ui_touchenabled?:boolean;
    input_driver?:any; // Default: GamepadDriver(), false to disable
    sound_force_mono?:boolean; // Force mono sound. Defaults to false

    input_touch?:boolean;
    input_mousekeyboard?:boolean;
    input_legacykeyboard?:boolean;
    input_coop?:boolean; // Co-op双人模式开关，Default: false
    input_mousekeyboard_config?:MouseKeyboardConfig; // Default: MouseKeyboardConfig.default();
}

export default class xStreamingPlayer {

    _config:xStreamingPlayerConfig
    _webrtcClient:RTCPeerConnection| undefined
    _eventBus:EventBus

    _isResetting = false
    _isFSR = false

    _webrtcConfiguration: any = {
        iceServers: [
            {
                urls: 'stun:worldaz.relay.teams.microsoft.com:3478',
            },
            {
                urls: 'stun:stun.l.google.com:19302',
            }, 
            {
                urls: 'stun:stun1.l.google.com:19302',
            },
            {
                urls: 'stun:relay1.expressturn.com',
            },
            {
                urls: 'stun:relay2.expressturn.com',
            },
            {
                urls: 'stun:stun.kinesisvideo.us-east-1.amazonaws.com:443',
            },
            {
                urls: 'stun:stun.douyucdn.cn:18000',
            },
        ],
    }

    _webrtcDataChannelsConfig = {
        'input': {
            ordered: true,
            protocol: '1.0',
        },
        'chat': {
            protocol: 'chatV1',
        },
        'control': {
            protocol: 'controlV1',
        },
        'message': {
            protocol: 'messageV1',
        },
    }

    _webrtcStates = {
        iceGathering: 'open',
        iceConnection: 'open',
        iceCandidates: [],
        streamConnection: 'open',
    }

    _webrtcDataChannels = {}
    _webrtcChannelProcessors = {}

    _iceCandidates:Array<RTCIceCandidate> = []

    _elementHolder:string
    _elementHolderRandom:number

    _inputDriver:any = undefined
    _keyboardDriver:any = undefined

    _videoComponent
    _audioComponent

    _codecPreference = ''
    _codecProfiles:Array<any> = []
    _maxVideoBitrate = 0
    _maxAudioBitrate = 0

    _vibration = true
    _video_format = ''
    _gamepad_kernal = 'Native'
    _vibration_mode = 'Native'
    _gamepad_deadzone = 0.2
    _edge_compensation = 0
    _custom_gamepad_mapping = null
    _force_trigger_rumble = ''
    _gamepad_mix = false
    _gamepad_index = -1
    _audio_volume = 1
    _enable_audio_control = false
    _enable_audio_rumble = false
    _audio_rumble_threshold = 0.15
    _audio_gain_node: any = null
    _polling_rate = 250 // 手柄回报率
    _mouse_sensitive = 0.5 // 鼠标灵敏度
    _fsr_sharpness = 2 // FSR锐化等级 1-10

    constructor(elementId:string, config:xStreamingPlayerConfig = {}) {
        console.log('xStreamingPlayer loaded!')

        this._config = Object.assign({
            input_touch: false,
            input_mousekeyboard: false,
            input_legacykeyboard: true,
            input_coop: false,
        }, config)

        this._eventBus = new EventBus()
        this._elementHolder = elementId
        this._elementHolderRandom = (Math.floor(Math.random() * 100) + 1)
    }

    bind(params?: any) {
        if (params && params.turnServer) {
            this._webrtcConfiguration.iceServers.push({
                urls: params.turnServer.url,
                username: params.turnServer.username,
                credential: params.turnServer.credential,
            })
        }
        console.log('Init peerconnection:', this._webrtcConfiguration)
        this._webrtcClient = new RTCPeerConnection(this._webrtcConfiguration)
        
        this._openDataChannels()

        if(this._config.input_driver === undefined){
            this._inputDriver = new GamepadDriver()

        } else if(this._config.input_driver !== null){
            this._inputDriver = this._config.input_driver
        }

        this._inputDriver.setApplication(this)
        this._keyboardDriver = new KeyboardDriver(this._config.input_mousekeyboard_config ?? MouseKeyboardConfig.default())
        this._gatherIce()

        this._webrtcClient.ontrack = (event) => {

            if(event.track.kind === 'video'){
                this._videoComponent = new VideoComponent(this)
                this._videoComponent.create(event.streams[0])

            } else if(event.track.kind === 'audio'){
                this._audioComponent = new AudioComponent(this)
                this._audioComponent.create(event.streams[0])
            } else {
                console.log('Unknown Track kind: ', event.track.kind)
            }
        }

        this._webrtcClient.addTransceiver('audio', {
            direction: 'sendrecv',
        })
        this._webrtcClient.addTransceiver('video', {
            direction: 'recvonly',
        })

        this._webrtcClient.addEventListener( 'connectionstatechange', () => {
            console.log('connectionstatechange:', this._webrtcClient?.connectionState)
            if (this._webrtcClient?.connectionState === 'connected') {
                this.getEventBus().emit('connectionstate', { state: this._webrtcClient?.connectionState})
            }
            if (this._webrtcClient?.connectionState === 'failed') {
                console.log('restartIce')
                this._webrtcClient.restartIce()
                if (this._connectFailHandler) {
                    this._connectFailHandler()
                }
            }
        })
    }

    createOffer(){
        return new Promise((resolve, reject) => {
            if(this._webrtcClient === undefined){
                reject('webRTC client not started yet. Run .bind() first.')
                return
            }

            this.getEventBus().emit('connectionstate', { state: 'new'})

            this._webrtcClient.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true,
            }).then((offer) => {

                // Set Codec
                if(this._codecPreference !== '' && offer.sdp){
                    console.log('xStreamingPlayer index.ts - createOffer() Set codec preference mimetype to:', this._codecPreference)
                    offer.sdp = this._setCodec(offer.sdp, this._codecPreference, this._codecProfiles)
                }

                // Set bitrate
                if(this._maxVideoBitrate > 0){
                    console.log('xStreamingPlayer index.ts - createOffer() Set max video bitrate to:', this._maxVideoBitrate, 'kbps')
                    offer.sdp = this._setBitrate(offer.sdp, 'video', this._maxVideoBitrate * 1024)
                }

                if(this._maxAudioBitrate > 0){
                    console.log('xStreamingPlayer index.ts - createOffer() Set max audio bitrate to:', this._maxVideoBitrate, 'kbps')
                    offer.sdp = this._setBitrate(offer.sdp, 'audio', this._maxAudioBitrate * 1024)
                }

                if((this._config.sound_force_mono || false) !== true){
                    console.log('xStreamingPlayer index.ts - createOffer() Set audio to stereo')
                    offer.sdp = offer.sdp?.replace('useinbandfec=1', 'useinbandfec=1; stereo=1')
                }

                this._webrtcClient?.setLocalDescription(offer)
                resolve(offer)
            })
        })
    }

    _sdpHandler

    sdpNegotiationChat(){
        this.createOffer().then((offer) => {
            this._sdpHandler(this, offer)
        })
    }

    setSdpHandler(listener){
        this._sdpHandler = listener
    }

    setAudioBitrate(bitrate: number){
        this._maxAudioBitrate = bitrate
    }

    // bitrate Mb/s
    setVideoBitrate(bitrate: number){
        this._maxVideoBitrate = bitrate
    }

    setControllerRumble(state:boolean){
        this.getChannelProcessor('input')._rumbleEnabled = state
    }

    _setBitrate(sdp: any, media: string, bitrate: number) {
        const lines = sdp.split('\r\n')

        for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
            let _media: string = ''
            let line = lines[lineNumber]
            if (!line.startsWith('m=')) {
                continue
            }
            if (line.startsWith(`m=${media}`)) {
                _media = media
            }
            // Invalid media, continue looking
            if (!_media) {
                continue
            }

            const bLine = `b=AS:${bitrate}`

            while (lineNumber++, lineNumber < lines.length) {
                line = lines[lineNumber]

                // Ignore lines that start with "i=" or "c="
                if (line.startsWith('i=') || line.startsWith('c=')) {
                    continue
                }

                if (line.startsWith('b=AS:')) {
                    // Replace bitrate
                    lines[lineNumber] = bLine
                    // Stop lookine for "b=AS:" line
                    break
                }

                if (line.startsWith('m=')) {
                    // "b=AS:" line not found, add "b" line before "m="
                    lines.splice(lineNumber, 0, bLine)
                    // Stop
                    break
                }
            }
        }

        return lines.join('\r\n')
    }

    setVideoFormat(format: string) {
        this._video_format = format
    }

    setCodecPreferences(mimeType:string, options?:{ profiles: Array<any> }){
        this._codecPreference = mimeType
        if(options) {this._codecProfiles = options.profiles}
    }

    setGamepadKernal(kernal: string) {
        this._gamepad_kernal = kernal
    }

    setGamepadIndex(idx: number) {
        this._gamepad_index = idx
    }

    setGamepadMix(value: boolean) {
        this._gamepad_mix = value
    }

    setAudioVolume(value: number) {
        this._audio_volume = value || 1.0
    }

    setPollRate(value: number) {
        this._polling_rate = value || 250
    }

    setAudioControl(value: boolean) {
        this._enable_audio_control = value
    }

    setAudioVolumeDirect(value: number) {
        if (this._audio_gain_node && this._audio_gain_node.gain) {
            this._audio_gain_node.gain.value = value
        }
    }

    setKeyboardInput(enabled: boolean) {
        this._config.input_legacykeyboard = enabled
    }

    setCoOpMode(enabled: boolean) {
        this._config.input_coop = enabled
    }

    setVibration(isVibrated: boolean) {
        this._vibration = isVibrated
    }

    setMouseSensitive(value: number) {
        this._mouse_sensitive = value
    }

    setFsrSharpness(value: number) {
        this._fsr_sharpness = value
    }

    setFsrSharpnessDynamic(value: number) {
        if(this._videoComponent) {
            this._videoComponent.setFsrSharpnessDynamic(value)
        }
    }

    setVibrationMode(mode: string) {
        this._vibration_mode = mode
    }

    // _gamepad_deadzone
    setGamepadDeadZone(value: number) {
        this._gamepad_deadzone = value
    }

    setGamepadMaping(maping: any) {
        this._custom_gamepad_mapping = maping
    }
    
    setForceTriggerRumble(value: string) {
        this._force_trigger_rumble = value
    }

    setAudioRumble(enaled: boolean, threshold?: number) {
        this._enable_audio_rumble = enaled
        if(threshold) {
            this._audio_rumble_threshold = threshold
        }
    }

    _setCodec(sdp: string, mimeType:string, codecProfiles:Array<any>){
        const capabilities = RTCRtpReceiver.getCapabilities('video')
        if(capabilities === null){
            console.log('xStreamingPlayer index.ts - _setCodec() Failed to get video codecs')

        } else {
            const codecs = capabilities.codecs
            const prefCodecs:any = []
            
            for(let i = 0; i < codecs.length; i++){
                if(codecs[i].mimeType === mimeType){

                    if(codecProfiles.length > 0){
                        for(let j = 0; j < codecProfiles.length; j++){
                            if(codecs[i].sdpFmtpLine?.indexOf('profile-level-id='+codecProfiles[j]) !== -1){
                                console.log('xStreamingPlayer index.ts - Adding codec as preference:', codecs[i], codecProfiles[j])
                                prefCodecs.push(codecs[i])
                            }
                        }
                    } else {
                        console.log('xStreamingPlayer index.ts - Adding codec as preference:', codecs[i])
                        prefCodecs.push(codecs[i])
                    }
                }
            }

            if(prefCodecs.length === 0){
                console.log('xStreamingPlayer index.ts - _setCodec() No video codec matches with mimetype:', mimeType)
                return sdp
            }

            console.log('mimeType:', mimeType)
            // FIX H.264 codec
            if (mimeType.indexOf('H264') > -1) {
                // High=4d Medium=42e Low=420
                const h264Pattern = /a=fmtp:(\d+).*profile-level-id=([0-9a-f]{6})/g
                const profilePrefix = codecProfiles[0]
                const preferredCodecIds: string[] = []
                // Find all H.264 codec profile IDs
                const matches = sdp.matchAll(h264Pattern) || []
                for (const match of matches) {
                    const id = match[1]
                    const profileId = match[2]

                    if (profileId.startsWith(profilePrefix)) {
                        preferredCodecIds.push(id)
                    }
                }
                // No preferred IDs found
                if (!preferredCodecIds.length) {
                    return sdp
                }

                const lines = sdp.split('\r\n')
                for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
                    const line = lines[lineIndex]
                    if (!line.startsWith('m=video')) {
                        continue
                    }
            
                    // https://datatracker.ietf.org/doc/html/rfc4566#section-5.14
                    // m=<media> <port> <proto> <fmt>
                    // m=video 9 UDP/TLS/RTP/SAVPF 127 39 102 104 106 108
                    const tmp = line.trim().split(' ')
            
                    // Get array of <fmt>
                    // ['127', '39', '102', '104', '106', '108']
                    let ids = tmp.slice(3)
            
                    // Remove preferred IDs in the original array
                    ids = ids.filter(item => !preferredCodecIds.includes(item))
            
                    // Put preferred IDs at the beginning
                    ids = preferredCodecIds.concat(ids)
            
                    // Update line's content
                    lines[lineIndex] = tmp.slice(0, 3).concat(ids).join(' ')
            
                    break
                }

                return lines.join('\r\n')
            }
        }
    }

    setRemoteOffer(sdpdata:string){
        try {
            this._webrtcClient?.setRemoteDescription({
                type: 'answer',
                sdp: sdpdata,
            })
        } catch(e){
            console.log('xStreamingPlayer index.ts - setRemoteOffer() Remote SDP is not valid:', sdpdata)
        }

        this.getEventBus().emit('connectionstate', { state: 'connecting'})
    }

    startFSR(cb) {
        if(this._videoComponent && !this._isFSR) {
            console.log('startFSR')
            try {
                this._videoComponent.startFSR()
                this._isFSR = true
                cb && cb()
            } catch(e) {
                console.log('FSR failed.')
            }
        }
    }

    reset(){
        if(!this._isResetting){
            this._isResetting = true
            this._webrtcClient?.close()

            if(this._audioComponent) {this._audioComponent.destroy()}

            if(this._videoComponent) {this._videoComponent.destroy()}
            
            for(const name in this._webrtcChannelProcessors){
                this._webrtcChannelProcessors[name].destroy()
            }

            this._inputDriver.stop()
            this._keyboardDriver.stop()

            this._webrtcClient = new RTCPeerConnection(this._webrtcConfiguration)
            this._openDataChannels()
            this._inputDriver.start()
            this._keyboardDriver.start()

            this._gatherIce()
            this._isResetting = false
        }
    }

    close(){
        if(!this._isResetting){
            this._isResetting = true
            this._webrtcClient?.close()

            if(this._audioComponent) {this._audioComponent.destroy()}

            if(this._videoComponent) {this._videoComponent.destroy()}
            
            for(const name in this._webrtcChannelProcessors){
                this._webrtcChannelProcessors[name].destroy()
            }
            this._webrtcChannelProcessors = {}

            this._inputDriver.stop()
            this._keyboardDriver.stop()
        }
    }

    getIceCandidates(){
        return this._iceCandidates
    }

    setIceCandidates(iceDetails){
        if(iceDetails.length === 0){
            window.alert('Error: No candidates received!')
        }

        for(const candidate in iceDetails){
            if(iceDetails[candidate].candidate === 'a=end-of-candidates'){
                // iceDetails[candidate].candidate = ''
                continue
            }

            const hasInvalidTcpType = iceDetails[candidate].candidate.includes('UDP') && iceDetails[candidate].candidate.includes('tcptype')
            if (hasInvalidTcpType) {
                console.warn('Skipping invalid candidate:', iceDetails[candidate])
                continue
            }

            this._webrtcClient?.addIceCandidate({
                candidate: iceDetails[candidate].candidate,
                sdpMid: iceDetails[candidate].sdpMid,
                sdpMLineIndex: iceDetails[candidate].sdpMLineIndex,
            })
        }
    }

    _connectFailHandler

    setConnectFailHandler(listener) {
        this._connectFailHandler = listener
    }

    getChannel(name:string){
        return this._webrtcDataChannels[name]
    }

    _openDataChannels(){
        for(const channel in this._webrtcDataChannelsConfig){
            this._openDataChannel(channel, this._webrtcDataChannelsConfig[channel])
        }
    }

    _openDataChannel(name:string, config){
        console.log('xStreamingPlayer index.ts - Creating data channel:', name, config)

        this._webrtcDataChannels[name] = this._webrtcClient?.createDataChannel(name, config)

        switch(name) {
            case 'input':
                this._webrtcChannelProcessors[name] = new InputChannel('input', this)
                break
            case 'control':
                this._webrtcChannelProcessors[name] = new ControlChannel('control', this)
                break
            case 'chat':
                this._webrtcChannelProcessors[name] = new ChatChannel('chat', this)
                break
            case 'message':
                this._webrtcChannelProcessors[name] = new MessageChannel('message', this)
                break
        }

        // Setup channel processors
        this._webrtcDataChannels[name].addEventListener('open', (event) => {
            // const message = event.data;
            if(this._webrtcChannelProcessors[name] !== undefined && this._webrtcChannelProcessors[name].onOpen !== undefined){
                this._webrtcChannelProcessors[name].onOpen(event)
            } else {
                console.log('xStreamingPlayer index.ts - ['+name+'] Got open channel:', event)
            }
        })
    
        this._webrtcDataChannels[name].addEventListener('message', event => {
            // const message = new Uint8Array(event.data);
            if(this._webrtcChannelProcessors[name] !== undefined && this._webrtcChannelProcessors[name].onMessage !== undefined){
                this._webrtcChannelProcessors[name].onMessage(event)
            } else {
                console.log('xStreamingPlayer index.ts - ['+name+'] Received channel message:', event)
            }
        })

        this._webrtcDataChannels[name].addEventListener('closing', event => {
            // const message = event.data;
            if(this._webrtcChannelProcessors[name] !== undefined && this._webrtcChannelProcessors[name].onClosing !== undefined){
                this._webrtcChannelProcessors[name].onClosing(event)
            } else {
                console.log('xStreamingPlayer index.ts - ['+name+'] Got closing channel:', event)
            }
        })

        this._webrtcDataChannels[name].addEventListener('close', event => {
            // const message = event.data;
            if(this._webrtcChannelProcessors[name] !== undefined && this._webrtcChannelProcessors[name].onClose !== undefined){
                this._webrtcChannelProcessors[name].onClose(event)
            } else {
                console.log('xStreamingPlayer index.ts - ['+name+'] Got close channel:', event)
            }
        })

        this._webrtcDataChannels[name].addEventListener('error', event => {
            // const message = event.data;
            if(this._webrtcChannelProcessors[name] !== undefined && this._webrtcChannelProcessors[name].onError !== undefined){
                this._webrtcChannelProcessors[name].onError(event)
            } else {
                console.log('xStreamingPlayer index.ts - ['+name+'] Got error channel:', event)
            } 
        })

        // Check if we have a video connection
        if(name === 'input'){
            this._webrtcChannelProcessors[name].addEventListener('state', (event) => {
                this._webrtcStates.streamConnection = event.state

                this.getEventBus().emit('connectionstate', { state: event.state})
                console.log('xStreamingPlayer index.ts - ['+name+'] Channel state changed to:', event)
            })
        }
    }

    _gatherIce(){
        this._webrtcClient?.addEventListener('icecandidate', event => {
            if (event.candidate) {
                console.log('xStreamingPlayer index.ts - ICE candidate found:', event.candidate)
                this._iceCandidates.push(event.candidate)
            }
        })
    }

    getDataChannel(name:string) {
        return this._webrtcDataChannels[name]
    }

    getChannelProcessor(name:string) {
        return this._webrtcChannelProcessors[name]
    }

    getEventBus() {
        return this._eventBus
    }

    getStreamState() {
        return new Promise(resove => {
            const performances = {
                resolution: globalThis.resolution,
                rtt: '-1 (-1%)',
                fps: 0,
                pl: '-1 (-1%)',
                fl: '-1 (-1%)',
                jit: '-1',
                br: '',
                decode: '',
            }
            if (this._webrtcClient) {
                this._webrtcClient.getStats().then(stats => {
                    stats.forEach(stat => {
                        if (stat.type === 'inbound-rtp' && stat.kind === 'video') {
                            // FPS
                            performances.fps = stat.framesPerSecond || 0
    
                            // Frames Dropped
                            const framesDropped = stat.framesDropped
                            if (framesDropped !== undefined) {
                                const framesReceived = stat.framesReceived
                                const framesDroppedPercentage = (framesDropped * 100 / ((framesDropped + framesReceived) || 1)).toFixed(2)
                                performances.fl = `${framesDropped} (${framesDroppedPercentage}%)`
                            } else {
                                performances.fl = '-1 (-1%)'
                            }
    
                            // Packets Lost
                            const packetsLost = stat.packetsLost
                            if (packetsLost !== undefined) {
                                const packetsReceived = stat.packetsReceived
                                const packetsLostPercentage = (packetsLost * 100 / ((packetsLost + packetsReceived) || 1)).toFixed(2)
                                performances.pl = `${packetsLost} (${packetsLostPercentage}%)`
                            } else {
                                performances.pl = '-1 (-1%)'
                            }
    
                            if (globalThis._lastStat) {
                                try {
                                    const lastStat = globalThis._lastStat
                                    // Bitrate
                                    const timeDiff = stat.timestamp - lastStat.timestamp
                                    if (timeDiff !== 0) {
                                        const bitrate = 8 * (stat.bytesReceived - lastStat.bytesReceived) / timeDiff / 1000
                                        performances.br = `${bitrate.toFixed(2)} Mbps`
                                    } else {
                                        performances.br = '--'
                                    }

                                    // Jitter
                                    const bufferDelayDiff = (stat as RTCInboundRtpStreamStats).jitterBufferDelay! - lastStat.jitterBufferDelay!
                                    const emittedCountDiff = (stat as RTCInboundRtpStreamStats).jitterBufferEmittedCount! - lastStat.jitterBufferEmittedCount!
                                    if (emittedCountDiff > 0) {
                                        performances.jit = Math.round(bufferDelayDiff / emittedCountDiff * 1000) + 'ms'
                                    } else {
                                        performances.jit = '--'
                                    }
                                    
        
                                    // Decode time
                                    // Show decode time is a bug on Chromium based browsers on Android,so just reduce it.
                                    // Refer: https://github.com/redphx/better-xcloud/discussions/113
                                    const totalDecodeTimeDiff = stat.totalDecodeTime - lastStat.totalDecodeTime
                                    const framesDecodedDiff = stat.framesDecoded - lastStat.framesDecoded
                                    if (framesDecodedDiff !== 0) {
                                        let currentDecodeTime = totalDecodeTimeDiff / framesDecodedDiff * 1000

                                        if (window.ReactNativeWebView) {
                                            // Fix decode time incorrect in webview
                                            if (currentDecodeTime > 20) {
                                                currentDecodeTime -= 20
                                            }
                                            if (currentDecodeTime > 18) {
                                                currentDecodeTime -= 15
                                            }
                                        }
                                        
                                        performances.decode = `${currentDecodeTime.toFixed(2)}ms`
                                    } else {
                                        performances.decode = '--'
                                    }
                                    
                                } catch(e) {
                                    console.log('err:', e)
                                }
                            }

                            globalThis._lastStat = stat
                        } else if (stat.type === 'candidate-pair' && stat.state === 'succeeded') {
                            // Round Trip Time
                            const roundTripTime = typeof stat.currentRoundTripTime !== 'undefined' ? stat.currentRoundTripTime * 1000 : '???'
                            performances.rtt = `${roundTripTime}ms`
                        }
    
                    })
                    resove(performances)
                })
            }
        })
        
    }

}
