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
    input_mousekeyboard_config?:MouseKeyboardConfig; // Default: MouseKeyboardConfig.default();
}

export default class xStreamingPlayer {

    _config:xStreamingPlayerConfig
    _webrtcClient:RTCPeerConnection| undefined
    _eventBus:EventBus

    _isResetting = false

    _webrtcConfiguration = {
        iceServers: [{
            urls: 'stun:stun.l.google.com:19302',
        }, {
            urls: 'stun:stun1.l.google.com:19302',
        }],
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
    _isNativeVibration = false
    _gamepad_deadzone = 0.2
    _custom_gamepad_mapping = null

    constructor(elementId:string, config:xStreamingPlayerConfig = {}) {
        console.log('xStreamingPlayer loaded!')

        this._config = Object.assign({
            input_touch: false,
            input_mousekeyboard: false,
            input_legacykeyboard: true,
        }, config)

        this._eventBus = new EventBus()
        this._elementHolder = elementId
        this._elementHolderRandom = (Math.floor(Math.random() * 100) + 1)
    }

    bind(){
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
    }

    createOffer(){
        return new Promise((resolve, reject) => {
            if(this._webrtcClient === undefined){
                reject('webRTC client not started yet. Run .bind() first.')
                return
            }

            this.getEventBus().emit('connectionstate', { state: 'new'})

            if(this._codecPreference !== ''){
                console.log('xStreamingPlayer index.ts - createOffer() Set codec preference mimetype to:', this._codecPreference)
                this._setCodec(this._codecPreference, this._codecProfiles)
            }

            this._webrtcClient.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true,
            }).then((offer) => {

                // Set bitrate
                if(this._maxVideoBitrate > 0){
                    console.log('xStreamingPlayer index.ts - createOffer() Set max video bitrate to:', this._maxVideoBitrate, 'kbps')
                    offer.sdp = this._setBitrate(offer.sdp, 'video', this._maxVideoBitrate)
                }

                if(this._maxAudioBitrate > 0){
                    console.log('xStreamingPlayer index.ts - createOffer() Set max audio bitrate to:', this._maxVideoBitrate, 'kbps')
                    offer.sdp = this._setBitrate(offer.sdp, 'audio', this._maxAudioBitrate)
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

    setAudioBitrate(bitrate_kbps:number){
        this._maxAudioBitrate = bitrate_kbps
    }

    setVideoBitrate(bitrate_kbps:number){
        this._maxVideoBitrate = bitrate_kbps
    }

    setControllerRumble(state:boolean){
        this.getChannelProcessor('input')._rumbleEnabled = state
    }

    _setBitrate(sdp, media, bitrate) {
        const lines = sdp.split('\n')
        let line = -1
        for(let i=0; i < lines.length; i++) {
            if(lines[i].indexOf('m='+media) === 0) {
                line = i
                break
            }
        }
        if (line === -1) {
            console.debug('Could not find the m line for', media)
            return sdp
        }
        line++

        while(lines[line].indexOf('i=') === 0 || lines[line].indexOf('c=') === 0) {
            line++
        }
       
        if (lines[line].indexOf('b') === 0) {
            lines[line] = 'b=AS:'+bitrate
            return lines.join('\n')
        }
        
        let newLines = lines.slice(0, line)
        newLines.push('b=AS:'+bitrate)
        newLines = newLines.concat(lines.slice(line, lines.length))

        return newLines.join('\n')
    }

    setCodecPreferences(mimeType:string, options?:{ profiles: Array<any> }){
        this._codecPreference = mimeType
        if(options) {this._codecProfiles = options.profiles}
    }

    setVibration(isVibrated: boolean) {
        this._vibration = isVibrated
    }

    setVibrationMode(isNativeVibration: boolean) {
        this._isNativeVibration = isNativeVibration
    }

    // _gamepad_deadzone
    setGamepadDeadZone(value: number) {
        this._gamepad_deadzone = value
    }

    setGamepadMaping(maping: any) {
        this._custom_gamepad_mapping = maping
    }

    _setCodec(mimeType:string, codecProfiles:Array<any>){
        const tcvr = this._webrtcClient?.getTransceivers()[1]
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
            }

            if(tcvr?.setCodecPreferences !== undefined){
                tcvr?.setCodecPreferences(prefCodecs)
            } else {
                console.log('xStreamingPlayer index.ts - _setCodec() Browser does not support setCodecPreferences()')
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
        for(const candidate in iceDetails){
            if(iceDetails[candidate].candidate === 'a=end-of-candidates'){
                iceDetails[candidate].candidate = ''
            }

            this._webrtcClient?.addIceCandidate({
                candidate: iceDetails[candidate].candidate,
                sdpMid: iceDetails[candidate].sdpMid,
                sdpMLineIndex: iceDetails[candidate].sdpMLineIndex,
            })
        }
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
                br: '',
                decode: '',
            }
            if (this._webrtcClient) {
                this._webrtcClient.getStats().then(stats => {
                    stats.forEach(stat => {
                        if (stat.type === 'inbound-rtp' && stat.kind === 'video') {
                            // FPS(帧率)
                            if (stat.type === 'inbound-rtp' && stat.kind === 'video') {
                                performances.fps = stat.framesPerSecond || 0
                            }
    
                            // Frames Dropped（丢帧）
                            const framesDropped = stat.framesDropped
                            if (framesDropped !== undefined) {
                                const framesReceived = stat.framesReceived
                                const framesDroppedPercentage = (framesDropped * 100 / ((framesDropped + framesReceived) || 1)).toFixed(2)
                                performances.fl = `${framesDropped} (${framesDroppedPercentage}%)`
                            } else {
                                performances.fl = '-1 (-1%)'
                            }
    
                            // Packets Lost（丢包）
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
                                    // Bitrate(码率)
                                    const timeDiff = stat.timestamp - lastStat.timestamp
                                    if (timeDiff !== 0) {
                                        const bitrate = 8 * (stat.bytesReceived - lastStat.bytesReceived) / timeDiff / 1000
                                        performances.br = `${bitrate.toFixed(2)} Mbps`
                                    } else {
                                        performances.br = '--'
                                    }
                                    
        
                                    // Decode time（解码时间）
                                    const totalDecodeTimeDiff = stat.totalDecodeTime - lastStat.totalDecodeTime
                                    const framesDecodedDiff = stat.framesDecoded - lastStat.framesDecoded
                                    if (framesDecodedDiff !== 0) {
                                        const currentDecodeTime = totalDecodeTimeDiff / framesDecodedDiff * 1000
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
                            // Round Trip Time（延迟）
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