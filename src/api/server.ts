import express, { Request, Response } from 'express';
import { ZoomBot } from '../bot/ZoomBot';
import { StorageManager } from '../storage/StorageManager';
import { VideoProcessor } from '../video/VideoProcessor';
import * as path from 'path';

export class ApiServer {
    private app = express();
    private bot: ZoomBot | null = null;
    private storage: StorageManager;
    private videoProcessor: VideoProcessor;
    private port: number;
    private currentVideoPath: string | null = null; // ← NUEVO

    constructor(port: number = 3000) {
        this.port = port;
        this.storage = new StorageManager(process.env.GCS_BUCKET_NAME!);
        this.videoProcessor = new VideoProcessor();
        this.setupMiddleware();
        this.setupRoutes();
    }

    private setupMiddleware(): void {
        this.app.use(express.json());
        this.app.use(express.urlencoded({ extended: true }));

        // CORS para permitir acceso desde el navegador
        this.app.use((req, res, next) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
            next();
        });

        // Servir videos con configuración especial
        this.app.get('/videos/:filename', (req, res) => {
            const filename = req.params.filename;
            const filePath = path.join(__dirname, '../../temp', filename);

            console.log('📹 Solicitando video:', filename);
            console.log('📂 Ruta completa:', filePath);

            const fs = require('fs');

            // Verificar que existe
            if (!fs.existsSync(filePath)) {
                console.error('❌ Archivo no encontrado:', filePath);
                return res.status(404).send('Video no encontrado');
            }

            const stat = fs.statSync(filePath);
            const fileSize = stat.size;
            const range = req.headers.range;
            console.log('headers:', req.headers);
            console.log('📊 Tamaño del archivo:', fileSize, 'bytes');
            console.log('📍 Range solicitado:', range || 'ninguno');

            // Determinar Content-Type
            const ext = path.extname(filename).toLowerCase();
            const contentTypes: { [key: string]: string } = {
                '.mp4': 'video/mp4',
                '.webm': 'video/webm',  // ← AÑADIR ESTO
                '.ogg': 'video/ogg'
            };
            const contentType = contentTypes[ext] || 'application/octet-stream';
            console.log('📋 Range type:', typeof range, range);
            if (range) {
                // Soporte para streaming parcial (range requests)
                const parts = range.replace(/bytes=/, '').split('-');
                const start = parseInt(parts[0], 10);
                const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
                const chunksize = (end - start) + 1;
                const file = fs.createReadStream(filePath, { start, end });

                res.writeHead(206, {
                    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                    'Accept-Ranges': 'bytes',
                    'Content-Length': chunksize,
                    'Content-Type': contentType,
                    'Cache-Control': 'no-cache'
                });

                console.log(start, end, fileSize, {
                    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                    'Accept-Ranges': 'bytes',
                    'Content-Length': chunksize,
                    'Content-Type': contentType,
                    'Cache-Control': 'no-cache'
                })

                file.pipe(res);
            } else {
                // Enviar archivo completo
                res.writeHead(200, {
                    'Content-Length': fileSize,
                    'Content-Type': contentType,
                    'Accept-Ranges': 'bytes',
                    'Cache-Control': 'no-cache'
                });

                fs.createReadStream(filePath).pipe(res);
            }
        });
    }

    private setupRoutes(): void {
        // Health check
        this.app.get('/health', (req: Request, res: Response) => {
            res.json({ status: 'ok', timestamp: new Date().toISOString() });
        });

        // Iniciar bot
        this.app.post('/bot/start', async (req: Request, res: Response) => {
            try {
                this.bot = new ZoomBot({
                    email: process.env.ZOOM_EMAIL!,
                    password: process.env.ZOOM_PASSWORD!,
                    headless: false,
                });

                await this.bot.launch();
                await this.bot.login();

                res.json({ success: true, message: 'Bot iniciado y logueado' });
            } catch (error: any) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // Unirse a reunión
        this.app.post('/bot/join', async (req: Request, res: Response) => {
            try {
                if (!this.bot) {
                    return res.status(400).json({ success: false, error: 'Bot no iniciado' });
                }

                const { meetingId, password } = req.body;
                await this.bot.joinMeeting(meetingId, password);

                res.json({ success: true, message: 'Bot unido a la reunión' });
            } catch (error: any) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // Transmitir video
        this.app.post('/bot/stream', async (req: Request, res: Response) => {
            try {
                if (!this.bot || !this.bot.isInMeetingNow()) {
                    return res.status(400).json({ success: false, error: 'Bot no está en reunión' });
                }

                const { videoFileName } = req.body;

                console.log('📦 Iniciando proceso de streaming...');

                // Descargar video
                const localPath = await this.storage.downloadVideo(videoFileName);

                // Procesar video
                const convertedPath = await this.videoProcessor.convertToWebRTC(localPath);

                // Verificar video
                const isValid = await this.videoProcessor.verifyVideo(convertedPath);
                if (!isValid) {
                    throw new Error('El video convertido no es válido');
                }

                // Guardar la ruta del video actual
                this.currentVideoPath = convertedPath;

                // ✅ CONSTRUIR URL HTTP (no usar ruta de archivo)
                const videoFileName_converted = path.basename(convertedPath);
                const videoUrl = `http://localhost:${this.port}/videos/${videoFileName_converted}`;

                console.log('🌐 URL HTTP del video:', videoUrl);

                // Esperar un momento para que el archivo esté disponible
                await new Promise(resolve => setTimeout(resolve, 1000));

                // Setup cámara virtual
                await this.bot.setupVirtualCamera(videoUrl);
                await this.bot.startVideo();

                res.json({
                    success: true,
                    message: 'Video streaming iniciado',
                    videoPath: convertedPath,
                    videoUrl: videoUrl
                });
            } catch (error: any) {
                console.error('❌ Error en streaming:', error);
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // Salir de reunión
        this.app.post('/bot/leave', async (req: Request, res: Response) => {
            try {
                if (!this.bot) {
                    return res.status(400).json({ success: false, error: 'Bot no iniciado' });
                }

                await this.bot.leaveMeeting();
                res.json({ success: true, message: 'Bot salió de la reunión' });
            } catch (error: any) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // Detener bot
        this.app.post('/bot/stop', async (req: Request, res: Response) => {
            try {
                if (this.bot) {
                    await this.bot.close();
                    this.bot = null;
                }
                res.json({ success: true, message: 'Bot detenido' });
            } catch (error: any) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // Listar videos disponibles
        this.app.get('/videos', async (req: Request, res: Response) => {
            try {
                const videos = await this.storage.listVideos();
                res.json({ success: true, videos });
            } catch (error: any) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // Nueva ruta: Preparar video ANTES de unirse
        this.app.post('/bot/prepare-video', async (req: Request, res: Response) => {
            try {
                if (!this.bot) {
                    return res.status(400).json({ success: false, error: 'Bot no iniciado' });
                }

                const { videoFileName } = req.body;

                console.log('📦 Preparando video...');

                // Descargar video
                const localPath = await this.storage.downloadVideo(videoFileName);

                // Procesar video
                const convertedPath = await this.videoProcessor.convertToWebRTC(localPath);

                // Verificar que el video sea válido
                const isValid = await this.videoProcessor.verifyVideo(convertedPath);
                if (!isValid) {
                    throw new Error('El video convertido no es válido');
                }

                // NUEVO: Verificar que el archivo existe y tiene tamaño
                const fs = require('fs');
                const stats = fs.statSync(convertedPath);
                console.log('📊 Archivo convertido:', {
                    path: convertedPath,
                    size: `${(stats.size / 1024 / 1024).toFixed(2)} MB`,
                    exists: fs.existsSync(convertedPath)
                });

                // Guardar la ruta del video actual
                this.currentVideoPath = convertedPath;

                // Construir URL HTTP del video
                const videoFileName_converted = path.basename(convertedPath);
                const videoUrl = `http://localhost:${this.port}/videos/${videoFileName_converted}`;

                console.log('🌐 URL del video:', videoUrl);

                // NUEVO: Verificar que la URL es accesible desde Node
                const http = require('http');
                await new Promise<void>((resolve, reject) => {
                    http.get(videoUrl, (response: any) => {
                        console.log('✅ URL accesible, status:', response.statusCode);
                        console.log('📋 Headers:', response.headers);
                        resolve();
                    }).on('error', (err: any) => {
                        console.error('❌ URL no accesible:', err);
                        reject(err);
                    });
                });

                // Esperar un momento para que el archivo esté completamente escrito
                await new Promise(resolve => setTimeout(resolve, 2000));

                // Configurar cámara virtual con la URL HTTP
                await this.bot.setupVirtualCamera(videoUrl);

                console.log('✅ Video preparado y listo para la reunión');

                res.json({
                    success: true,
                    message: 'Video preparado. Ahora puedes unirte a la reunión.',
                    videoPath: convertedPath,
                    videoUrl: videoUrl
                });
            } catch (error: any) {
                console.error('❌ Error preparando video:', error);
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // La ruta /bot/stream ahora solo activa el video si ya estás en reunión
        this.app.post('/bot/stream', async (req: Request, res: Response) => {
            try {
                if (!this.bot || !this.bot.isInMeetingNow()) {
                    return res.status(400).json({ success: false, error: 'Bot no está en reunión' });
                }

                // Si ya está en la reunión, activar el video
                await this.bot.startVideo();

                console.log('🎉 Video activado en la reunión');

                res.json({
                    success: true,
                    message: 'Video activado'
                });
            } catch (error: any) {
                console.error('❌ Error:', error);
                res.status(500).json({ success: false, error: error.message });
            }
        });
    }

    start(): void {
        this.app.listen(this.port, () => {
            console.log(`🚀 API Server running on http://localhost:${this.port}`);
        });
    }
}