export const enum StreamVideoProcessing {
    USM = 'usm',
    CAS = 'cas',
}

const enum StreamVideoProcessingMode {
    QUALITY = 'quality',
    PERFORMANCE = 'performance',
}

type StreamPlayerOptions = {
    processing: StreamVideoProcessing;
    processingMode: StreamVideoProcessingMode;
    sharpness: number;
    saturation: number;
    contrast: number;
    brightness: number;
};

export const enum StreamPlayerElement {
    VIDEO = 'video',
    CANVAS = 'canvas',
}

const enum StreamPlayerType {
    VIDEO = 'default',
    WEBGL2 = 'webgl2',
    WEBGPU = 'webgpu',
}

export const enum StreamPlayerFilter {
    USM = 1,
    CAS = 2,
}

export abstract class BaseStreamPlayer {
    protected logTag: string
    protected playerType: StreamPlayerType
    protected elementType: StreamPlayerElement
    protected $video: HTMLVideoElement

    protected options: any = {
        processing: StreamVideoProcessing.USM,
        sharpness: 0,
        brightness: 1.0,
        contrast: 1.0,
        saturation: 1.0,
    }

    protected isStopped = false

    constructor(playerType: StreamPlayerType, elementType: StreamPlayerElement, $video: HTMLVideoElement, logTag: string) {
        this.playerType = playerType
        this.elementType = elementType
        this.$video = $video
        this.logTag = logTag
    }

    init() {
        console.log(this.logTag, 'Initialize')
    }

    updateOptions(newOptions: Partial<StreamPlayerOptions>, refresh=false) {
        this.options = Object.assign(this.options, newOptions)
        refresh && this.refreshPlayer()
    }

    abstract refreshPlayer(): void;
}
