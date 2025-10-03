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
        await this.page.fill('input[type="email"]', this.config.email);
        await this.page.fill('input[type="password"]', this.config.password);

        // Click en Sign In
        await this.page.click('button[type="submit"]');

        // Esperar a que cargue el dashboard
        await this.page.waitForURL('**/profile', { timeout: 30000 });

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

        this.isInMeeting = true;
        console.log('✅ Dentro de la reunión');
    }

    async setupVirtualCamera(videoUrl: string): Promise<void> {
        if (!this.page) throw new Error('Browser not launched');

        console.log('🎥 Configurando cámara virtual con video...');
        console.log('🌐 URL del video:', videoUrl);

        try {
            // Primero, verificar que el script de inyección está disponible
            const scriptLoaded = await this.page.evaluate(() => {
                return typeof window.setCustomVideoStream === 'function';
            });

            if (!scriptLoaded) {
                console.warn('⚠️ Script de inyección no detectado, reinyectando...');
                await this.page.addInitScript({
                    path: path.join(__dirname, 'inject-video.js')
                });
                await this.page.waitForTimeout(1000);
            }

            // Inyectar y reproducir el video usando URL HTTP
            const result = await this.page.evaluate((videoSrc) => {
                return new Promise<{ success: boolean; error?: string }>((resolve) => {
                    try {
                        console.log('🎬 Creando elemento de video en el DOM');
                        console.log('🌐 Cargando desde:', videoSrc);

                        // Crear elemento de video oculto
                        const video = document.createElement('video');
                        video.src = videoSrc;
                        video.loop = true;
                        video.muted = true;
                        video.autoplay = true;
                        video.playsInline = true;
                        video.crossOrigin = 'anonymous';
                        video.style.position = 'fixed';
                        video.style.top = '-9999px';
                        video.style.left = '-9999px';
                        video.style.width = '1280px';
                        video.style.height = '720px';
                        document.body.appendChild(video);

                        let resolved = false;

                        video.onloadeddata = () => {
                            console.log('📦 Datos del video cargados');
                            console.log('📊 Video info:', {
                                duration: video.duration,
                                width: video.videoWidth,
                                height: video.videoHeight,
                                readyState: video.readyState
                            });
                        };

                        video.oncanplay = () => {
                            console.log('✅ Video listo para reproducir');

                            video.play()
                                .then(() => {
                                    console.log('▶️ Video reproduciendo');

                                    // Esperar un frame antes de capturar
                                    setTimeout(() => {
                                        // Configurar el stream personalizado
                                        if (typeof window.setCustomVideoStream === 'function') {
                                            window.setCustomVideoStream(video);
                                            console.log('✅ Stream personalizado activado');
                                            if (!resolved) {
                                                resolved = true;
                                                resolve({ success: true });
                                            }
                                        } else {
                                            console.error('❌ setCustomVideoStream no está disponible');
                                            if (!resolved) {
                                                resolved = true;
                                                resolve({
                                                    success: false,
                                                    error: 'setCustomVideoStream not found'
                                                });
                                            }
                                        }
                                    }, 100);
                                })
                                .catch((err) => {
                                    console.error('❌ Error reproduciendo video:', err);
                                    if (!resolved) {
                                        resolved = true;
                                        resolve({
                                            success: false,
                                            error: `Play error: ${err.message}`
                                        });
                                    }
                                });
                        };

                        video.onerror = (e) => {
                            const error = video.error;
                            let errorMsg = 'Error desconocido';
                            if (error) {
                                switch (error.code) {
                                    case 1:
                                        errorMsg = 'MEDIA_ERR_ABORTED: Descarga abortada';
                                        break;
                                    case 2:
                                        errorMsg = 'MEDIA_ERR_NETWORK: Error de red';
                                        break;
                                    case 3:
                                        errorMsg = 'MEDIA_ERR_DECODE: Error decodificando';
                                        break;
                                    case 4:
                                        errorMsg = 'MEDIA_ERR_SRC_NOT_SUPPORTED: Formato no soportado';
                                        break;
                                }
                                errorMsg += ` - ${error.message}`;
                            }
                            console.error('❌ Error cargando video:', errorMsg);
                            if (!resolved) {
                                resolved = true;
                                resolve({
                                    success: false,
                                    error: errorMsg
                                });
                            }
                        };

                        // Timeout de seguridad (20 segundos)
                        setTimeout(() => {
                            if (!resolved) {
                                resolved = true;
                                console.error('⏱️ Timeout cargando video');
                                resolve({
                                    success: false,
                                    error: 'Timeout después de 20s'
                                });
                            }
                        }, 20000);

                        // Forzar carga
                        video.load();

                    } catch (err: any) {
                        console.error('❌ Error en evaluate:', err);
                        resolve({
                            success: false,
                            error: err.message || String(err)
                        });
                    }
                });
            }, videoUrl);

            if (!result.success) {
                throw new Error(`Error configurando video: ${result.error}`);
            }

            console.log('✅ Cámara virtual configurada exitosamente');

            // Esperar un poco más para asegurar que el stream esté estable
            await this.page.waitForTimeout(2000);

        } catch (error: any) {
            console.error('❌ Error en setupVirtualCamera:', error);
            throw error;
        }
    }

    async startVideo(): Promise<void> {
        if (!this.page) throw new Error('Browser not launched');

        // Click en botón de video
        const videoButton = await this.page.$('[aria-label*="start video"], [aria-label*="Stop video"]');
        if (videoButton) {
            await videoButton.click();
            console.log('✅ Video iniciado');
        }
    }

    async leaveMeeting(): Promise<void> {
        if (!this.page) throw new Error('Browser not launched');

        console.log('👋 Saliendo de la reunión...');

        // Click en botón de salir
        const leaveButton = await this.page.$('button:has-text("Leave")');
        if (leaveButton) {
            await leaveButton.click();
            await this.page.waitForTimeout(1000);
        }

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