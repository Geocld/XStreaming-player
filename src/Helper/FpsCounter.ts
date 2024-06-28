import xStreamingPlayer from '..'

export default class FpsCounter {

    _name:string
    _application:xStreamingPlayer

    _counter = 0
    _eventInterval

    constructor(application:xStreamingPlayer, name:string) {
        this._name = name
        this._application = application
    }

    start() {
        this._eventInterval = setInterval(() => {
            // console.log('xStreamingPlayer Helper/FpsCounter.ts [fps_'+this._name+'] - Emit fps:', this._counter)

            this._application.getEventBus().emit('fps_'+this._name, {
                fps: this._counter,
            })

            this._counter = 0
        }, 1000)
    }

    stop() {
        clearInterval(this._eventInterval)
    }

    count() {
        this._counter++
    }

}