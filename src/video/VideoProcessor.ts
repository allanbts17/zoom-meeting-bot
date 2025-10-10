import ffmpeg from 'fluent-ffmpeg';
import * as path from 'path';

// Importar FFmpeg estático
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;

export interface VideoInfo {
    duration: number;
    width: number;
    height: number;
    fps: number;
    hasAudio: boolean;
}

export class VideoProcessor {
    constructor() {
        // Configurar rutas de FFmpeg
        console.log('🔧 Configurando FFmpeg...');
        console.log('FFmpeg path:', ffmpegPath);
        console.log('FFprobe path:', ffprobePath);

        ffmpeg.setFfmpegPath(ffmpegPath);
        ffmpeg.setFfprobePath(ffprobePath);

        console.log('✅ FFmpeg configurado');
    }

    async getVideoInfo(videoPath: string): Promise<VideoInfo> {
        return new Promise((resolve, reject) => {
            ffmpeg.ffprobe(videoPath, (err, metadata) => {
                if (err) {
                    reject(err);
                    return;
                }

                const videoStream = metadata.streams.find(s => s.codec_type === 'video');
                const audioStream = metadata.streams.find(s => s.codec_type === 'audio');

                resolve({
                    duration: metadata.format.duration || 0,
                    width: videoStream?.width || 0,
                    height: videoStream?.height || 0,
                    fps: eval(videoStream?.r_frame_rate || '30') || 30,
                    hasAudio: !!audioStream,
                });
            });
        });
    }

    async convertToWebRTC(inputPath: string, outputPath?: string): Promise<string> {
        // Cambiar extensión a .webm
        const output = outputPath || inputPath.replace(path.extname(inputPath), '_converted.webm');

        return new Promise((resolve, reject) => {
            console.log('🔄 Convirtiendo video a WebM para Chromium...');
            console.log('📂 Input:', inputPath);
            console.log('📂 Output:', output);

            ffmpeg(inputPath)
                .outputOptions([
                    // Video - VP8 o VP9 (códecs open source)
                    '-c:v', 'libvpx',              // Codec VP8 (compatible con Chromium)
                    '-b:v', '2M',                  // Bitrate de video
                    '-crf', '10',                  // Calidad (0-63, menor = mejor)
                    '-quality', 'realtime',        // Velocidad de encoding

                    // Audio - Vorbis u Opus (open source)
                    '-c:a', 'libvorbis',          // Codec Vorbis
                    '-b:a', '128k',               // Bitrate de audio
                    '-ar', '48000',               // Sample rate

                    // Resolución y FPS
                    '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:black',
                    '-r', '30',                    // 30 FPS

                    // Formato
                    '-f', 'webm'
                ])
                .output(output)
                .on('start', (commandLine) => {
                    console.log('🎬 FFmpeg command:', commandLine);
                })
                .on('end', () => {
                    console.log('✅ Video WebM convertido exitosamente');
                    resolve(output);
                })
                .on('error', (err, stdout, stderr) => {
                    console.error('❌ Error convirtiendo video:', err.message);
                    console.error('FFmpeg stderr:', stderr);
                    reject(err);
                })
                .on('progress', (progress) => {
                    if (progress.percent) {
                        console.log(`Progreso: ${progress.percent.toFixed(1)}%`);
                    }
                })
                .run();
        });
    }
    // async convertToWebRTC(inputPath: string, outputPath?: string): Promise<string> {
    //     const output = outputPath || inputPath.replace(path.extname(inputPath), '_converted.mp4');

    //     return new Promise((resolve, reject) => {
    //         console.log('🔄 Convirtiendo video para streaming...');
    //         console.log('📂 Input:', inputPath);
    //         console.log('📂 Output:', output);

    //         ffmpeg(inputPath)
    //             .outputOptions([
    //                 // Video - Forzar escala y padding para 16:9
    //                 '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:black',
    //                 '-c:v', 'libx264',            // Codec H.264
    //                 '-profile:v', 'baseline',      // Perfil baseline
    //                 '-level', '3.0',               // Level 3.0
    //                 '-preset', 'ultrafast',        // Velocidad de encoding
    //                 '-pix_fmt', 'yuv420p',        // Formato de pixel
    //                 '-r', '30',                    // 30 FPS fijos

    //                 // Audio
    //                 '-c:a', 'aac',                // Codec AAC
    //                 '-b:a', '128k',               // Bitrate de audio
    //                 '-ar', '48000',               // Sample rate
    //                 '-ac', '2',                   // Stereo

    //                 // Streaming
    //                 '-movflags', '+faststart',    // Metadata al inicio
    //                 '-max_muxing_queue_size', '1024'  // Buffer más grande
    //             ])
    //             .output(output)
    //             .on('start', (commandLine) => {
    //                 console.log('🎬 FFmpeg command:', commandLine);
    //             })
    //             .on('end', () => {
    //                 console.log('✅ Video convertido exitosamente');
    //                 resolve(output);
    //             })
    //             .on('error', (err, stdout, stderr) => {
    //                 console.error('❌ Error convirtiendo video:', err.message);
    //                 console.error('FFmpeg stderr:', stderr);
    //                 reject(err);
    //             })
    //             .on('progress', (progress) => {
    //                 if (progress.percent) {
    //                     console.log(`Progreso: ${progress.percent.toFixed(1)}%`);
    //                 }
    //             })
    //             .run();
    //     });
    // }

    async verifyVideo(videoPath: string): Promise<boolean> {
        try {
            const info = await this.getVideoInfo(videoPath);
            console.log('📊 Información del video:', {
                duration: `${info.duration.toFixed(2)}s`,
                resolution: `${info.width}x${info.height}`,
                fps: info.fps,
                hasAudio: info.hasAudio
            });

            return info.width > 0 && info.height > 0;
        } catch (error) {
            console.error('❌ Error verificando video:', error);
            return false;
        }
    }

    async extractAudio(videoPath: string): Promise<string> {
        const audioPath = videoPath.replace(path.extname(videoPath), '.mp3');

        return new Promise((resolve, reject) => {
            ffmpeg(videoPath)
                .output(audioPath)
                .noVideo()
                .audioCodec('libmp3lame')
                .on('end', () => resolve(audioPath))
                .on('error', reject)
                .run();
        });
    }
}