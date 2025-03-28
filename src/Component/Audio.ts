import xStreamingPlayer from '..'

export default class AudioComponent {

    _client:xStreamingPlayer

    _audioSource
    _mediaSource
    _audioRender

    constructor(client:xStreamingPlayer) {
        this._client = client
    }

    create(srcObject) {
        console.log('xStreamingPlayer Component/Audio.ts - Create media element')

        const audioHolder = document.getElementById(this._client._elementHolder)

        const audioCtx = new (window.AudioContext)()
        const source = audioCtx.createMediaStreamSource(srcObject)
        const gainNode = audioCtx.createGain()
        source.connect(gainNode).connect(audioCtx.destination)
        if (this._client._audio_volume) {
            this._client._audio_volume = +this._client._audio_volume
        }
        gainNode.gain.value = this._client._audio_volume || 1.0

        this._client._audio_gain_node = gainNode

        if(audioHolder !== null){
            const audioRender = document.createElement('audio')
            audioRender.id = this.getElementId()
            audioRender.srcObject = srcObject
            // audioRender.play()

            audioRender.autoplay = true

            this._audioRender = audioRender
            
            audioHolder.appendChild(audioRender)
        } else {
            console.log('xStreamingPlayer Component/Audio.ts - Error fetching audioholder: div#'+this._client._elementHolder)
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
        
        document.getElementById(this.getElementId())?.remove()

        console.log('xStreamingPlayer Component/Audio.ts - Cleaning up audio element')
    }

    _isSafari(){
        return (navigator.userAgent.search('Safari') >= 0 && navigator.userAgent.search('Chrome') < 0)
    }
}