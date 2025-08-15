import { BaseCanvasPlayer } from './BaseCanvasPlayer'

const enum StreamPlayerType {
    VIDEO = 'default',
    WEBGL2 = 'webgl2',
    WEBGPU = 'webgpu',
}

const enum StreamVideoProcessingMode {
    QUALITY = 'quality',
    PERFORMANCE = 'performance',
}

export class WebGL2Player extends BaseCanvasPlayer {
    private gl: WebGL2RenderingContext | null = null
    private resources: Array<WebGLBuffer | WebGLTexture | WebGLProgram | WebGLShader> = []
    private program: WebGLProgram | null = null

    constructor($video: HTMLVideoElement) {
        super(StreamPlayerType.WEBGL2, $video, 'WebGL2Player')
    }

    private updateCanvas() {
        console.log('updateCanvas', this.options)

        const gl = this.gl!
        const program = this.program!
        const filterId = this.toFilterId(this.options.processing)

        gl.uniform2f(gl.getUniformLocation(program, 'iResolution'), this.$canvas.width, this.$canvas.height)

        gl.uniform1i(gl.getUniformLocation(program, 'filterId'), filterId)
        gl.uniform1i(gl.getUniformLocation(program, 'qualityMode'), this.options.processingMode === StreamVideoProcessingMode.QUALITY ? 1 : 0)
        gl.uniform1f(gl.getUniformLocation(program, 'sharpenFactor'), this.options.sharpness / (this.options.processingMode === StreamVideoProcessingMode.QUALITY ? 1 : 1.2))
        gl.uniform1f(gl.getUniformLocation(program, 'brightness'), this.options.brightness / 100)
        gl.uniform1f(gl.getUniformLocation(program, 'contrast'), this.options.contrast / 100)
        gl.uniform1f(gl.getUniformLocation(program, 'saturation'), this.options.saturation / 100)
    }

    updateFrame() {
        const gl = this.gl!
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, this.$video)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
    }

    protected async setupShaders(): Promise<void> {
        const gl = this.$canvas.getContext('webgl2', {
            isBx: true,
            antialias: true,
            alpha: false,
            depth: false,
            preserveDrawingBuffer: false,
            stencil: false,
            powerPreference: 'default', // "default" | "high-performance" | "low-power"
        } as WebGLContextAttributes) as WebGL2RenderingContext
        this.gl = gl

        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
        // gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferWidth)

        // 顶点着色器
        // Vertex shader: Identity map
        const vShader = gl.createShader(gl.VERTEX_SHADER)!
        gl.shaderSource(vShader, `#version 300 es

in vec4 position;

void main() {
    gl_Position = position;
}`)
        gl.compileShader(vShader)

        // 片元着色器
        const fShader = gl.createShader(gl.FRAGMENT_SHADER)!
        gl.shaderSource(fShader, `#version 300 es

precision mediump float;
uniform sampler2D data;
uniform vec2 iResolution;

const int FILTER_UNSHARP_MASKING = 1;
const int FILTER_CAS = 2;

// constrast = 0.8
const float CAS_CONTRAST_PEAK = 0.8 * -3.0 + 8.0;

// Luminosity factor: https://www.w3.org/TR/AERT/#color-contrast
const vec3 LUMINOSITY_FACTOR = vec3(0.299, 0.587, 0.114);

uniform int filterId;
uniform bool qualityMode;
uniform float sharpenFactor;
uniform float brightness;
uniform float contrast;
uniform float saturation;

out vec4 fragColor;

vec3 clarityBoost(sampler2D tex, vec2 coord, vec3 e) {
    vec2 texelSize = 1.0 / iResolution.xy;

    // Load a collection of samples in a 3x3 neighorhood, where e is the current pixel.
    // a b c
    // d e f
    // g h i
    vec3 b = texture(tex, coord + texelSize * vec2(0, 1)).rgb;
    vec3 d = texture(tex, coord + texelSize * vec2(-1, 0)).rgb;
    vec3 f = texture(tex, coord + texelSize * vec2(1, 0)).rgb;
    vec3 h = texture(tex, coord + texelSize * vec2(0, -1)).rgb;

    vec3 a;
    vec3 c;
    vec3 g;
    vec3 i;

    if (filterId == FILTER_UNSHARP_MASKING || qualityMode) {
        a = texture(tex, coord + texelSize * vec2(-1, 1)).rgb;
        c = texture(tex, coord + texelSize * vec2(1, 1)).rgb;
        g = texture(tex, coord + texelSize * vec2(-1, -1)).rgb;
        i = texture(tex, coord + texelSize * vec2(1, -1)).rgb;
    }

    // USM
    if (filterId == FILTER_UNSHARP_MASKING) {
        vec3 gaussianBlur = (a + c + g + i) * 1.0 + (b + d + f + h) * 2.0 + e * 4.0;
        gaussianBlur /= 16.0;

        // Return edge detection
        return e + (e - gaussianBlur) * sharpenFactor / 3.0;
    }

    // CAS
    // Soft min and max.
    //  a b c             b
    //  d e f * 0.5  +  d e f * 0.5
    //  g h i             h
    // These are 2.0x bigger (factored out the extra multiply).
    vec3 minRgb = min(min(min(d, e), min(f, b)), h);
    vec3 maxRgb = max(max(max(d, e), max(f, b)), h);

    if (qualityMode) {
        minRgb += min(min(a, c), min(g, i));
        maxRgb += max(max(a, c), max(g, i));
    }

    // Smooth minimum distance to signal limit divided by smooth max.
    vec3 reciprocalMaxRgb = 1.0 / maxRgb;
    vec3 amplifyRgb = clamp(min(minRgb, 2.0 - maxRgb) * reciprocalMaxRgb, 0.0, 1.0);

    // Shaping amount of sharpening.
    amplifyRgb = inversesqrt(amplifyRgb);

    vec3 weightRgb = -(1.0 / (amplifyRgb * CAS_CONTRAST_PEAK));
    vec3 reciprocalWeightRgb = 1.0 / (4.0 * weightRgb + 1.0);

    //                0 w 0
    // Filter shape:  w 1 w
    //                0 w 0
    vec3 window = b + d + f + h;
    vec3 outColor = clamp((window * weightRgb + e) * reciprocalWeightRgb, 0.0, 1.0);

    return mix(e, outColor, sharpenFactor / 2.0);
}

void main() {
    vec2 uv = gl_FragCoord.xy / iResolution.xy;
    // Get current pixel
    vec3 color = texture(data, uv).rgb;

    // Clarity boost
    if (sharpenFactor > 0.0) {
        color = clarityBoost(data, uv, color);
    }

    // Saturation
    color = mix(vec3(dot(color, LUMINOSITY_FACTOR)), color, saturation);

    // Contrast
    color = contrast * (color - 0.5) + 0.5;

    // Brightness
    color = brightness * color;

    fragColor = vec4(color, 1.0);
}
`)
        gl.compileShader(fShader)

        // Create and link program
        const program = gl.createProgram()!
        this.program = program

        gl.attachShader(program, vShader)
        gl.attachShader(program, fShader)
        gl.linkProgram(program)
        gl.useProgram(program)

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error(`Link failed: ${gl.getProgramInfoLog(program)}`)
            console.error(`vs info-log: ${gl.getShaderInfoLog(vShader)}`)
            console.error(`fs info-log: ${gl.getShaderInfoLog(fShader)}`)
        }

        this.updateCanvas()

        // Vertices: A screen-filling quad made from two triangles
        const buffer = gl.createBuffer() as any
        this.resources.push(buffer)

        gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1.0, -1.0, // Bottom-left
            3.0, -1.0,  // Bottom-right
            -1.0, 3.0,  // Top-left
        ]), gl.STATIC_DRAW)

        gl.enableVertexAttribArray(0)
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

        // Texture to contain the video data
        const texture = gl.createTexture() as any
        this.resources.push(texture)

        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

        // Bind texture to the "data" argument to the fragment shader
        gl.uniform1i(gl.getUniformLocation(program, 'data'), 0)

        gl.activeTexture(gl.TEXTURE0)
        // gl.bindTexture(gl.TEXTURE_2D, texture);
    }

    destroy() {
        super.destroy()

        const gl = this.gl
        if (!gl) {
            return
        }

        gl.getExtension('WEBGL_lose_context')?.loseContext()
        gl.useProgram(null)

        for (const resource of this.resources) {
            if (resource instanceof WebGLProgram) {
                gl.deleteProgram(resource)
            } else if (resource instanceof WebGLShader) {
                gl.deleteShader(resource)
            } else if (resource instanceof WebGLTexture) {
                gl.deleteTexture(resource)
            } else if (resource instanceof WebGLBuffer) {
                gl.deleteBuffer(resource)
            }
        }

        this.gl = null
    }

    refreshPlayer(): void {
        this.updateCanvas()
    }
}