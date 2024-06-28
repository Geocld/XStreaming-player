import xStreamingPlayer from '..'

export default class BitrateCounter {

    _name:string
    _application:xStreamingPlayer

    _bitratePackets:Array<number> = []
    _bitrateData:Array<number> = []

    _eventInterval

    constructor(application:xStreamingPlayer, name:string) {
        this._name = name
        this._application = application
    }

    start() {
        this._eventInterval = setInterval(() => {

            let bitratePacketsValue = 0
            let bitrateDataValue = 0

            for(const frame in this._bitratePackets){
                if(this._bitratePackets[frame] !== undefined){
                    bitratePacketsValue += this._bitratePackets[frame]
                }
            }
            for(const audio in this._bitrateData){
                if(this._bitrateData[audio] !== undefined){
                    bitrateDataValue += this._bitrateData[audio]
                }
            }

            bitratePacketsValue = Math.round((bitratePacketsValue*8)/1000)
            bitrateDataValue = Math.round((bitrateDataValue*8)/1000)

            // console.log('xStreamingPlayer Helper/BitrateCounter.ts [bitrate_'+this._name+'] - Emit packets:', bitratePacketsValue+' bps,', 'data:', bitrateDataValue+' bps')

            this._application.getEventBus().emit('bitrate_'+this._name, {
                packets: Math.round(bitratePacketsValue*100)/100,
                packets_unit: 'bps',
                data: Math.round(bitrateDataValue*100)/100,
                data_unit: 'bps',
            })

            this._bitratePackets = []
            this._bitrateData = []
        }, 1000)
    }

    stop() {
        clearInterval(this._eventInterval)
    }

    count(packetLength, dataLength) {
        this._bitratePackets.push(packetLength)
        this._bitrateData.push(dataLength)
    }

    countPacket(packetLength) {
        this._bitratePackets.push(packetLength)
    }

    countData(dataLength) {
        this._bitrateData.push(dataLength)
    }

}