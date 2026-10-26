# Publicar una versión

## Una sola vez: firmar las actualizaciones automáticas

FocusPill solo instala actualizaciones firmadas con tu clave. La clave pública ya está en `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`). La privada no está en el repositorio y nunca debe estarlo.

1. En GitHub, abre **Settings → Secrets and variables → Actions → New repository secret**.
2. Crea `TAURI_SIGNING_PRIVATE_KEY` y pega el contenido completo del archivo `focuspill.key`.
3. La clave se generó sin contraseña, así que `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` no hace falta.

Guarda `focuspill.key` en un gestor de contraseñas. **Si la pierdes**, las instalaciones existentes no podrán actualizarse solas: tendrías que generar otra con `npx tauri signer generate -w focuspill.key`, cambiar la clave pública y pedir a los usuarios que instalen a mano una vez.

Sin el secreto, la Release se publica igual, pero sin actualizaciones automáticas.

## Cada versión

1. Sube el número de versión en `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` y `package.json`.
2. Añade los cambios a `CHANGELOG.md`.
3. Crea la etiqueta y súbela:

   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```

4. El flujo **Release** compila en GitHub Actions:
   - **Linux:** `.deb`, `.rpm` y `.AppImage`.
   - **Windows:** `.msi` y `-setup.exe`.
   - `latest.json`, el archivo que leen las actualizaciones automáticas.
5. Revisa el **borrador** en *Releases* y pulsa **Publish**. Desde ese momento, las instalaciones existentes ven la actualización en *Ajustes*.

También se puede lanzar a mano desde *Actions → Release → Run workflow*.

## Notas

- **Windows:** los instaladores no están firmados con un certificado de código, así que SmartScreen pedirá confirmación. Un certificado OV/EV (unos 100–300 € al año) elimina el aviso; se configura en `bundle.windows.certificateThumbprint` o con `signCommand`.
- **Linux:** las actualizaciones automáticas funcionan con AppImage. Con `.deb` y `.rpm`, la app avisa de la nueva versión y el usuario la instala con su gestor de paquetes. Si tu distro empaqueta FocusPill en su repositorio, las actualizaciones llegan por ahí.
