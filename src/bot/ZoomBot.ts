import { chromium, Browser, Page, BrowserContext } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

// Extiende la interfaz Window para incluir setCustomVideoStream
declare global {
    interface Window {
        setCustomVideoStream?: (video: HTMLVideoElement) => void;
    }
}

export interface ZoomBotConfig {
    email: string;
    password: string;
    headless?: boolean;
}

export class ZoomBot {
    private browser: Browser | null = null;
    private context: BrowserContext | null = null;
    private page: Page | null = null;
    private config: ZoomBotConfig;
    private isInMeeting: boolean = false;

    constructor(config: ZoomBotConfig) {
        this.config = {
            ...config,
            headless: config.headless ?? false, // Por defecto visible para debug
        };
        console.log('🤖 ZoomBot configurado con:', config)
    }

    async launch(): Promise<void> {
        console.log('🚀 Iniciando navegador...');

        this.browser = await chromium.launch({
            headless: this.config.headless,
            args: [
                '--use-fake-ui-for-media-stream',
                '--use-fake-device-for-media-stream',
                '--disable-blink-features=AutomationControlled',
            ],
        });

        this.context = await this.browser.newContext({
            permissions: ['camera', 'microphone'],
            viewport: { width: 1280, height: 720 },
        });

        this.page = await this.context.newPage();

        // 🎬 INYECTAR EL SCRIPT INMEDIATAMENTE
        console.log('🎬 Inyectando script de interceptación de video...');
        await this.page.addInitScript({
            path: path.join(__dirname, 'inject-video.js')
        });

        console.log('✅ Navegador iniciado con script inyectado');
    }

    async login(): Promise<void> {
        if (!this.page) throw new Error('Browser not launched');

        console.log('🔐 Iniciando sesión en Zoom...');

        await this.page.goto('https://zoom.us/signin');
        await this.page.waitForLoadState('networkidle');

        // Llenar formulario de login
        await this.page.fill('input[type="text"]', this.config.email);
        // Click en Sign In
        await this.page.click('#signin_btn_next');
        await this.page.fill('input[type="password"]', this.config.password);
        await this.page.click('#js_btn_login');
        // Esperar a que cargue el dashboard
        await this.page.waitForURL('**/myhome', { timeout: 30000 });

        console.log('✅ Login exitoso');
    }

    async joinMeeting(meetingId: string, password?: string): Promise<void> {
        if (!this.page) throw new Error('Browser not launched');

        console.log(`🎬 Uniéndose a reunión: ${meetingId}`);

        // Construir URL de la reunión
        const meetingUrl = `https://zoom.us/wc/join/${meetingId}`;
        await this.page.goto(meetingUrl);

        // Esperar a que cargue
        await this.page.waitForLoadState('networkidle');

        // Si requiere contraseña
        if (password) {
            const passwordInput = await this.page.$('input[type="password"]');
            if (passwordInput) {
                await passwordInput.fill(password);
                await this.page.click('button:has-text("Join")');
            }
        }

        // Esperar a entrar a la reunión
        await this.page.waitForSelector('[aria-label*="mute"]', { timeout: 60000 });
        await this.muteMic();
        await this.stopVideo();


        this.isInMeeting = true;
        console.log('✅ Dentro de la reunión');
    }

    async setupVirtualCamera(videoUrl: string): Promise<void> {
        if (!this.page) throw new Error('Browser not launched');

        console.log('🎥 Configurando cámara virtual con video y audio...');
        console.log('🌐 URL del video:', videoUrl);

        try {
            const result = await this.page.evaluate((videoSrc) => {
                return new Promise<{ success: boolean; error?: string }>((resolve) => {
                    try {
                        console.log('🎬 Creando elemento de video en el DOM');
                        console.log('🌐 Cargando desde:', videoSrc);

                        // Crear elemento de video oculto
                        const video = document.createElement('video');
                        video.src = videoSrc;
                        video.loop = true;
                        video.muted = false; // ⚠️ CAMBIADO: NO muted para capturar audio
                        video.autoplay = true;
                        video.playsInline = true;
                        video.crossOrigin = 'anonymous';
                        video.volume = 1.0; // ⚠️ NUEVO: Volumen al máximo
                        video.style.position = 'fixed';
                        video.style.top = '-9999px';
                        video.style.left = '-9999px';
                        video.style.width = '1280px';
                        video.style.height = '720px';
                        video.setAttribute('data-custom-stream', 'true');
                        document.body.appendChild(video);

                        let resolved = false;

                        video.oncanplay = () => {
                            console.log('✅ Video listo para reproducir');

                            video.play()
                                .then(() => {
                                    console.log('▶️ Video reproduciendo con audio');

                                    setTimeout(() => {
                                        try {
                                            // ===== CANVAS PARA VIDEO =====
                                            const canvas = document.createElement('canvas');
                                            canvas.width = 1280;
                                            canvas.height = 720;
                                            canvas.setAttribute('data-custom-canvas', 'true');
                                            const ctx = canvas.getContext('2d', { alpha: false });

                                            if (!ctx) {
                                                throw new Error('No se pudo crear contexto de canvas');
                                            }

                                            console.log('✅ Canvas creado para video');

                                            // Capturar frames del video
                                            function captureFrame() {
                                                if (video.readyState >= 2) {
                                                    ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
                                                }
                                                requestAnimationFrame(captureFrame);
                                            }
                                            captureFrame();

                                            // Crear stream de video desde el canvas
                                            const videoStream = canvas.captureStream(30);
                                            const videoTrack = videoStream.getVideoTracks()[0];

                                            console.log('✅ Video stream creado');

                                            // ===== CAPTURAR AUDIO DEL VIDEO =====
                                            // Crear AudioContext para capturar el audio
                                            const audioContext = new AudioContext();
                                            const source = audioContext.createMediaElementSource(video);
                                            const destination = audioContext.createMediaStreamDestination();

                                            // Conectar el audio del video al destino
                                            source.connect(destination);
                                            // También conectar a los speakers para escucharlo localmente (opcional)
                                            source.connect(audioContext.destination);

                                            const audioTrack = destination.stream.getAudioTracks()[0];

                                            console.log('✅ Audio capturado del video');
                                            console.log('🎵 Audio track ID:', audioTrack.id);

                                            // ===== COMBINAR VIDEO + AUDIO =====
                                            const combinedStream = new MediaStream([videoTrack, audioTrack]);

                                            console.log('✅ Stream combinado creado:', {
                                                videoTracks: combinedStream.getVideoTracks().length,
                                                audioTracks: combinedStream.getAudioTracks().length
                                            });

                                            // Guardar en window
                                            (window as any).__customVideoStream = combinedStream;
                                            (window as any).__customVideoTrack = videoTrack;
                                            (window as any).__customAudioTrack = audioTrack;
                                            (window as any).__audioContext = audioContext;

                                            // ===== INTERCEPTOR DE getUserMedia =====
                                            const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

                                            navigator.mediaDevices.getUserMedia = async function (constraints) {
                                                console.log('🎥 getUserMedia interceptado, constraints:', constraints);

                                                if ((window as any).__customVideoStream) {
                                                    const customStream = (window as any).__customVideoStream;

                                                    // Si pide video Y audio, retornar ambos
                                                    if (constraints?.video && constraints?.audio) {
                                                        console.log('✅ Retornando video + audio personalizado');
                                                        return customStream;
                                                    }
                                                    // Si solo pide video
                                                    else if (constraints?.video) {
                                                        console.log('✅ Retornando solo video personalizado');
                                                        return new MediaStream([videoTrack]);
                                                    }
                                                    // Si solo pide audio
                                                    else if (constraints?.audio) {
                                                        console.log('✅ Retornando solo audio personalizado');
                                                        return new MediaStream([audioTrack]);
                                                    }
                                                }

                                                console.log('📹 Usando getUserMedia original');
                                                return originalGetUserMedia(constraints);
                                            };

                                            console.log('✅ Interceptor configurado con audio');

                                            if (!resolved) {
                                                resolved = true;
                                                resolve({ success: true });
                                            }
                                        } catch (err: any) {
                                            console.error('❌ Error configurando stream:', err);
                                            if (!resolved) {
                                                resolved = true;
                                                resolve({ success: false, error: err.message });
                                            }
                                        }
                                    }, 500);
                                })
                                .catch((err) => {
                                    console.error('❌ Error reproduciendo video:', err);
                                    if (!resolved) {
                                        resolved = true;
                                        resolve({ success: false, error: err.message });
                                    }
                                });
                        };

                        video.onerror = (e) => {
                            const error = video.error;
                            let errorMsg = 'Error desconocido';
                            if (error) {
                                errorMsg = `Error ${error.code}: ${error.message}`;
                            }
                            console.error('❌ Error cargando video:', errorMsg);
                            if (!resolved) {
                                resolved = true;
                                resolve({ success: false, error: errorMsg });
                            }
                        };

                        setTimeout(() => {
                            if (!resolved) {
                                resolved = true;
                                resolve({ success: false, error: 'Timeout' });
                            }
                        }, 20000);

                        video.load();

                    } catch (err: any) {
                        resolve({ success: false, error: err.message });
                    }
                });
            }, videoUrl);

            if (!result.success) {
                throw new Error(`Error configurando video: ${result.error}`);
            }

            console.log('✅ Cámara virtual configurada con audio exitosamente');
            await this.page.waitForTimeout(2000);

        } catch (error: any) {
            console.error('❌ Error en setupVirtualCamera:', error);
            throw error;
        }
    }

    async startVideo(): Promise<void> {
        if (!this.page) throw new Error('Browser not launched');
        const videoButton = await this.page.locator('button[aria-label="start my video"]')
        if (videoButton) {
            await videoButton.dblclick();
            console.log('✅ Video iniciado');
        }
    }

    async stopVideo(): Promise<void> {
        if (!this.page) throw new Error('Browser not launched');
        const videoButton = await this.page.locator('button[aria-label="stop my video"]')
        if (videoButton) {
            await videoButton.dblclick();
            console.log('✅ Video detenido');
        }
    }

    async muteMic(): Promise<void> {
        if (!this.page) throw new Error('Browser not launched');
        const micButton = await this.page.locator('button[aria-label="mute my microphone"]');
        if (micButton) {
            await micButton.click();
            console.log('✅ Mic muteado');
        }
    }

    async unmuteMic(): Promise<void> {
        if (!this.page) throw new Error('Browser not launched');
        const micButton = await this.page.locator('button[aria-label="unmute my microphone"]');
        if (micButton) {
            await micButton.click();
            console.log('✅ Mic abierto');
        }
    }

    async leaveMeeting(): Promise<void> {
        if (!this.page) throw new Error('Browser not launched');
        console.log('👋 Saliendo de la reunión...');
        await this.page.locator('button[aria-label="Leave"]').dblclick();
        await this.page.locator('button.leave-meeting-options__btn--danger').click();
        this.isInMeeting = false;
        console.log('✅ Reunión abandonada');
    }

    async close(): Promise<void> {
        if (this.browser) {
            await this.browser.close();
            console.log('✅ Navegador cerrado');
        }
    }

    getPage(): Page | null {
        return this.page;
    }

    isInMeetingNow(): boolean {
        return this.isInMeeting;
    }
}