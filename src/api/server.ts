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

        // Servir videos con headers correctos
        this.app.use('/videos', (req, res, next) => {
            // Configurar headers para video streaming
            res.setHeader('Accept-Ranges', 'bytes');
            res.setHeader('Access-Control-Allow-Origin', '*');

            // Determinar Content-Type basado en extensión
            const ext = path.extname(req.path).toLowerCase();
            const contentTypes: { [key: string]: string } = {
                '.mp4': 'video/mp4',
                '.webm': 'video/webm',
                '.ogg': 'video/ogg',
                '.mov': 'video/quicktime'
            };

            if (contentTypes[ext]) {
                res.setHeader('Content-Type', contentTypes[ext]);
            }

            next();
        }, express.static(path.join(__dirname, '../../temp')));
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

                // Descargar video
                const localPath = await this.storage.downloadVideo(videoFileName);

                // Procesar video
                const convertedPath = await this.videoProcessor.convertToWebRTC(localPath);

                // Setup cámara virtual
                await this.bot.setupVirtualCamera(convertedPath);
                await this.bot.startVideo();

                res.json({ success: true, message: 'Video streaming iniciado' });
            } catch (error: any) {
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

                // Guardar la ruta del video actual
                this.currentVideoPath = convertedPath;

                // Construir URL HTTP del video
                const videoFileName_converted = path.basename(convertedPath);
                const videoUrl = `http://localhost:${this.port}/videos/${videoFileName_converted}`;

                console.log('🌐 URL del video:', videoUrl);

                // Esperar un momento para que el archivo esté completamente escrito
                await new Promise(resolve => setTimeout(resolve, 1000));

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