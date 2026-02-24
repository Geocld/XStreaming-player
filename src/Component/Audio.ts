import xStreamingPlayer from '..'

function getVolume(analyser: AnalyserNode, dataArray: any) {
    analyser.getByteTimeDomainData(dataArray)

    let sumSquares = 0
    for (let i = 0; i < dataArray.length; i++) {
        const normalized = (dataArray[i] - 128) / 128
        sumSquares += normalized * normalized
    }
    const rms = Math.sqrt(sumSquares / dataArray.length)
    return rms
}

export default class AudioComponent {

    _client:xStreamingPlayer

    _audioSource
    _mediaSource
    _audioRender
    _timer

    constructor(client:xStreamingPlayer) {
        this._client = client
    }

    create(srcObject) {
        console.log('xStreamingPlayer Component/Audio.ts - Create media element')

        const audioHolder = document.getElementById(this._client._elementHolder)

        if (this._client._enable_audio_control) {
            const audioCtx = new (window.AudioContext)()
            const source = audioCtx.createMediaStreamSource(srcObject)

            if (this._client._enable_audio_rumble) {
                const analyser = audioCtx.createAnalyser()
                analyser.fftSize = 512
                source.connect(analyser)
                const dataArray = new Uint8Array(analyser.fftSize)

                analyser.getByteTimeDomainData(dataArray)
                this._timer = window.setInterval(() => {
                    const volume = getVolume(analyser, dataArray)
                    
                    if (volume > this._client._audio_rumble_threshold) {
                        if (this._client._vibration_mode === 'Webview') {
                            const gamepads = navigator.getGamepads()
                            for (let i = 0; i < gamepads.length; i++) {
                                const gp = gamepads[i]
                                if (gp && gp.vibrationActuator) {
                                    gp.vibrationActuator.playEffect('dual-rumble', {
                                        startDelay: 0,
                                        duration: 100,
                                        weakMagnitude: 1.0 * (volume / 0.5),
                                        strongMagnitude: 0,
                                    })
                                }
                            }
                        } else if (this._client._vibration_mode === 'Native') {
                            if (window.ReactNativeWebView) {
                                window.ReactNativeWebView.postMessage(
                                    JSON.stringify({
                                        type: 'audioVibration',
                                        message: {
                                            rumbleData: {
                                                startDelay: 0,
                                                duration: 100,
                                                weakMagnitude: 1.0 * (volume / 0.5),
                                                strongMagnitude: 0,

                                                leftTrigger: 0,
                                                rightTrigger: 0,
                                            },
                                            repeat: false,
                                        },
                                    }),
                                )
                            }
                        }
                        
                    }
                }, 16)
            }

            const gainNode = audioCtx.createGain()
            source.connect(gainNode).connect(audioCtx.destination)
            if (this._client._audio_volume) {
                this._client._audio_volume = +this._client._audio_volume
            }
            gainNode.gain.value = 1.0

            this._client._audio_gain_node = gainNode

            if(audioHolder !== null){
                const audioRender = document.createElement('audio')
                audioRender.id = this.getElementId()
                audioRender.srcObject = srcObject
                audioRender.muted = true // 关键：设置为静音，避免重复播放
                audioRender.autoplay = true
                this._audioRender = audioRender
                audioHolder.appendChild(audioRender)
            }
        } else {
            if(audioHolder !== null){
                const audioRender = document.createElement('audio')
                audioRender.id = this.getElementId()
                audioRender.srcObject = srcObject
                // audioRender.play()

                audioRender.autoplay = true

                if (this._client._enable_audio_rumble) {
                    const audioCtx = new (window.AudioContext)()
                    const source = audioCtx.createMediaStreamSource(srcObject)
                    const analyser = audioCtx.createAnalyser()
                    analyser.fftSize = 512
                    source.connect(analyser)
                    const dataArray = new Uint8Array(analyser.fftSize)

                    analyser.getByteTimeDomainData(dataArray)
                    this._timer = window.setInterval(() => {
                        const volume = getVolume(analyser, dataArray)
                        
                        if (volume > this._client._audio_rumble_threshold) {
                            if (this._client._vibration_mode === 'Webview') {
                                const gamepads = navigator.getGamepads()
                                for (let i = 0; i < gamepads.length; i++) {
                                    const gp = gamepads[i]
                                    if (gp && gp.vibrationActuator) {
                                        gp.vibrationActuator.playEffect('dual-rumble', {
                                            startDelay: 0,
                                            duration: 100,
                                            weakMagnitude: 1.0 * (volume / 0.5),
                                            strongMagnitude: 0,
                                        })
                                    }
                                }
                            } else if (this._client._vibration_mode === 'Native') {
                                if (window.ReactNativeWebView) {
                                    window.ReactNativeWebView.postMessage(
                                        JSON.stringify({
                                            type: 'audioVibration',
                                            message: {
                                                rumbleData: {
                                                    startDelay: 0,
                                                    duration: 100,
                                                    weakMagnitude: 1.0 * (volume / 0.5),
                                                    strongMagnitude: 0,

                                                    leftTrigger: 0,
                                                    rightTrigger: 0,
                                                },
                                                repeat: false,
                                            },
                                        }),
                                    )
                                }
                            }
                        }
                    }, 16)
                }

                this._audioRender = audioRender
                
                audioHolder.appendChild(audioRender)
            } else {
                console.log('xStreamingPlayer Component/Audio.ts - Error fetching audioholder: div#'+this._client._elementHolder)
            }
        }

        console.log('xStreamingPlayer Component/Audio.ts - Media element created')
    }

    getElementId(){
        return 'xStreamingPlayer_'+this._client._elementHolderRandom+'_audioRender'
    }

    getSource() {
        return this._audioSource
    }

    createMediaSource(){
        const mediaSource = new MediaSource()
        const audioSourceUrl = window.URL.createObjectURL(mediaSource)

        mediaSource.addEventListener('sourceopen', () => {
            console.log('xStreamingPlayer Component/Audio.ts - MediaSource opened. Attaching audioSourceBuffer...')

            // if safari?
            let codec = 'audio/webm;codecs=opus'
            if (this._isSafari()){
                codec = 'audio/mp4' // @TODO: Fix audio issues on Safari
            }
        
            const audioSourceBuffer = mediaSource.addSourceBuffer(codec)
            audioSourceBuffer.mode = 'sequence'

            audioSourceBuffer.addEventListener('error', (event) => {
                console.log('xStreamingPlayer Component/Audio.ts - Error audio...', event)
            })

            this._audioSource = audioSourceBuffer
        })

        this._mediaSource = mediaSource

        return audioSourceUrl
    }

    destroy() {
        if(this._audioRender){
            this._audioRender.pause()
            this._audioRender.remove()
        }

        delete this._mediaSource
        delete this._audioRender
        delete this._audioSource

        this._timer && clearInterval(this._timer)
        
        document.getElementById(this.getElementId())?.remove()

        console.log('xStreamingPlayer Component/Audio.ts - Cleaning up audio element')
    }

    _isSafari(){
        return (navigator.userAgent.search('Safari') >= 0 && navigator.userAgent.search('Chrome') < 0)
    }
}