{ pkgs }: {
  deps = [
    pkgs.xorg.libXrandr
    pkgs.xorg.libXfixes
    pkgs.xorg.libXext
    pkgs.xorg.libXdamage
    pkgs.xorg.libXcomposite
    pkgs.xorg.libxcb
    pkgs.xorg.libX11
    pkgs.mesa
    pkgs.libxkbcommon
    pkgs.alsa-lib
    pkgs.cairo
    pkgs.pango
    pkgs.gtk3
    pkgs.libdrm
    pkgs.expat
    pkgs.dbus
    pkgs.cups
    pkgs.at-spi2-atk
    pkgs.atk
    pkgs.nspr
    pkgs.nss
    pkgs.glib
    pkgs.azure-functions-core-tools
  ];
}