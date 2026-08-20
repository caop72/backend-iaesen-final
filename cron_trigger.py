import requests

# Esta es la URL de tu endpoint de sincronización en Render
URL = "https://backend-iaesen-final.onrender.com/api/admin/procesar-pendientes"

print("🚀 Iniciando sincronización por lotes con Google Sheets...")
try:
    # Hacemos la petición POST sin clave, porque el sistema ya usa GOOGLE_CREDENTIALS_JSON
    response = requests.post(URL, timeout=60)
    
    print(f"📡 Código HTTP: {response.status_code}")
    
    if response.status_code == 200:
        print("✅ Sincronización ejecutada exitosamente:")
        print(response.json())
    else:
        print(f"❌ Error en el servidor: {response.text}")
        
except Exception as e:
    print(f"❌ Error al conectar con Render: {e}")