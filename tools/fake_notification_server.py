#!/usr/bin/env python3
"""Gestor de notificaciones mínimo para probar FocusPill sin escritorio.

Ocupa org.freedesktop.Notifications en el bus de sesión y acepta las
notificaciones (como haría xfce4-notifyd o el de GNOME), sin mostrarlas.

Uso: python3 tools/fake_notification_server.py
"""

import gi

gi.require_version("Gio", "2.0")
from gi.repository import Gio, GLib  # noqa: E402

XML = """
<node>
  <interface name="org.freedesktop.Notifications">
    <method name="Notify">
      <arg type="s" direction="in"/><arg type="u" direction="in"/><arg type="s" direction="in"/>
      <arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="as" direction="in"/>
      <arg type="a{sv}" direction="in"/><arg type="i" direction="in"/><arg type="u" direction="out"/>
    </method>
    <method name="GetCapabilities"><arg type="as" direction="out"/></method>
    <method name="GetServerInformation">
      <arg type="s" direction="out"/><arg type="s" direction="out"/><arg type="s" direction="out"/><arg type="s" direction="out"/>
    </method>
    <method name="CloseNotification"><arg type="u" direction="in"/></method>
  </interface>
</node>
"""

counter = 0


def on_call(_conn, _sender, _path, _iface, method, params, invocation):
    global counter
    if method == "Notify":
        counter += 1
        print(f"Notificación {counter}: {params.unpack()[3]}", flush=True)
        invocation.return_value(GLib.Variant("(u)", (counter,)))
    elif method == "GetCapabilities":
        invocation.return_value(GLib.Variant("(as)", (["body", "body-hyperlinks"],)))
    elif method == "GetServerInformation":
        invocation.return_value(GLib.Variant("(ssss)", ("fake", "focuspill", "1", "1.2")))
    else:
        invocation.return_value(None)


def on_bus(conn, _name):
    for iface in Gio.DBusNodeInfo.new_for_xml(XML).interfaces:
        conn.register_object("/org/freedesktop/Notifications", iface, on_call, None, None)


if __name__ == "__main__":
    Gio.bus_own_name(Gio.BusType.SESSION, "org.freedesktop.Notifications", Gio.BusNameOwnerFlags.NONE, on_bus, lambda *_: print("Gestor de notificaciones de prueba listo", flush=True), None)
    GLib.MainLoop().run()
