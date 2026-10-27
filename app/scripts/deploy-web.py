#!/usr/bin/env python3
"""
Met en ligne le tableau de bord admin web sur app.selix.io (Hostinger, FTP).

    cd app && npx expo export --platform web --output-dir dist-web
    python3 scripts/deploy-web.py

Envoie le contenu de dist-web/ dans public_html/ en remplaçant les fichiers du
même nom. Rien n'est supprimé sur le serveur. Le mot de passe FTP est demandé
au clavier et n'est jamais enregistré.
"""
import ftplib
import getpass
import os
import sys

HOST = '88.223.84.175'
USER = 'u262891370.app.selix.io'
REMOTE_ROOT = 'public_html'
LOCAL_ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'dist-web')


def connect(password: str) -> ftplib.FTP:
    # FTPS (chiffré) si le serveur l'accepte, sinon FTP simple.
    try:
        ftp = ftplib.FTP_TLS(HOST, timeout=30)
        ftp.login(USER, password)
        ftp.prot_p()
        print('Connecté en FTPS.')
        return ftp
    except ftplib.error_perm:
        raise
    except Exception:
        ftp = ftplib.FTP(HOST, timeout=30)
        ftp.login(USER, password)
        print('Connecté en FTP (non chiffré).')
        return ftp


def ensure_dir(ftp: ftplib.FTP, path: str) -> None:
    try:
        ftp.mkd(path)
    except ftplib.error_perm:
        pass  # existe déjà


def main() -> None:
    if not os.path.isfile(os.path.join(LOCAL_ROOT, 'index.html')):
        sys.exit(f'Pas de build dans {LOCAL_ROOT} : lancez d’abord « npx expo export --platform web --output-dir dist-web ».')
    password = getpass.getpass(f'Mot de passe FTP pour {USER} : ')
    try:
        ftp = connect(password)
    except ftplib.error_perm as e:
        sys.exit(f'Connexion refusée : {e}')

    sent = 0
    for folder, dirs, files in os.walk(LOCAL_ROOT):
        rel = os.path.relpath(folder, LOCAL_ROOT)
        remote = REMOTE_ROOT if rel == '.' else f'{REMOTE_ROOT}/{rel}'
        if rel != '.':
            ensure_dir(ftp, remote)
        for name in sorted(files):
            if name == '.DS_Store':
                continue
            with open(os.path.join(folder, name), 'rb') as fh:
                ftp.storbinary(f'STOR {remote}/{name}', fh)
            sent += 1
            print(f'  ↑ {remote}/{name}')
    ftp.quit()
    print(f'\n{sent} fichiers envoyés. Le dashboard est en ligne sur https://app.selix.io')


if __name__ == '__main__':
    main()
