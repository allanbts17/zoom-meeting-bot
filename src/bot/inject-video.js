// inject-video.js
// Este script se inyecta en el navegador para interceptar getUserMedia

(function() {
  console.log('🎬 Script de interceptación de video cargado');

  // Guardar referencia original
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    console.error('❌ getUserMedia no disponible');
    return;
  }

  window.__originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  window.__customVideoStream = null;

  // Función para establecer el stream de video personalizado
  window.setCustomVideoStream = function(videoElement) {
    console.log(videoElement)
    console.log('videoElement',videoElement)
    console.log('📹 Configurando stream de video personalizado');
    
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      const ctx = canvas.getContext('2d', { alpha: false });

      if (!ctx) {
        console.error('❌ No se pudo crear contexto de canvas');
        return;
      }

      console.log('✅ Canvas creado:', canvas.width, 'x', canvas.height);

      // Capturar frames del video
      let animationId = null;
      function captureFrame() {
        if (videoElement && !videoElement.paused && !videoElement.ended && videoElement.readyState >= 2) {
          try {
            ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
          } catch (e) {
            console.error('Error dibujando frame:', e);
          }
        }
        animationId = requestAnimationFrame(captureFrame);
      }
      captureFrame();

      // Crear stream desde el canvas
      const stream = canvas.captureStream(30);
      window.__customVideoStream = stream;
      
      console.log('✅ Stream personalizado creado con', stream.getVideoTracks().length, 'tracks');
      
      // Cleanup cuando se detenga el video
      videoElement.addEventListener('ended', () => {
        if (animationId) {
          cancelAnimationFrame(animationId);
        }
      });
      
    } catch (error) {
      console.error('❌ Error en setCustomVideoStream:', error);
    }
  };

  // Interceptar getUserMedia
  navigator.mediaDevices.getUserMedia = async function(constraints) {
    console.log('🎥 getUserMedia interceptado, constraints:', constraints);
    
    try {
      // Si hay un stream personalizado y se solicita video, usarlo
      if (window.__customVideoStream && constraints && constraints.video) {
        console.log('✅ Retornando stream personalizado');
        
        const videoTrack = window.__customVideoStream.getVideoTracks()[0];
        
        if (!videoTrack) {
          console.error('❌ No hay video track en el stream personalizado');
          return window.__originalGetUserMedia(constraints);
        }
        
        // Si también necesita audio, obtenerlo del sistema
        if (constraints.audio) {
          try {
            const audioStream = await window.__originalGetUserMedia({ audio: constraints.audio });
            const audioTrack = audioStream.getAudioTracks()[0];
            return new MediaStream([videoTrack, audioTrack]);
          } catch (e) {
            console.warn('⚠️ No se pudo obtener audio, solo retornando video');
            return new MediaStream([videoTrack]);
          }
        }
        
        return new MediaStream([videoTrack]);
      }
      
      // Si no hay stream personalizado, usar el original
      console.log('📹 Usando getUserMedia original');
      return window.__originalGetUserMedia(constraints);
      
    } catch (error) {
      console.error('❌ Error en getUserMedia interceptado:', error);
      throw error;
    }
  };

  console.log('✅ Interceptor de video instalado correctamente');
})();