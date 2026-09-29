"""urllib transport with separate DNS/connect budgets and bounded socket lifetime."""

from __future__ import annotations

import http.client
import socket
import urllib.request
from time import monotonic

from .timeouts import CrawlTimeout, check_deadline, remaining_seconds, timeout_scope, wait_blocking


class BoundedHTTPConnection(http.client.HTTPConnection):
    dns_timeout = 10.0
    connect_timeout = 15.0

    def connect(self) -> None:
        with timeout_scope("dns", self.dns_timeout):
            addresses = wait_blocking(lambda: socket.getaddrinfo(self.host, self.port, 0, socket.SOCK_STREAM))
        with timeout_scope("connect", self.connect_timeout):
            started = monotonic()
            last_error: OSError | None = None
            for family, kind, protocol, _, address in addresses:
                connection = socket.socket(family, kind, protocol)
                try:
                    connection.settimeout(remaining_seconds(self.connect_timeout))
                    if self.source_address:
                        connection.bind(self.source_address)
                    connection.connect(address)
                    self.sock = connection
                    if self._tunnel_host:
                        self._tunnel()
                    self._secure_socket()
                    check_deadline()
                    self.sock.settimeout(self.timeout)
                    return
                except CrawlTimeout:
                    connection.close()
                    raise
                except TimeoutError as error:
                    connection.close()
                    raise CrawlTimeout("connect", started=started) from error
                except OSError as error:
                    connection.close()
                    last_error = error
            if last_error is not None:
                raise last_error
            raise OSError("DNS returned no usable address.")

    def _secure_socket(self) -> None:
        pass


class BoundedHTTPSConnection(http.client.HTTPSConnection, BoundedHTTPConnection):
    def connect(self) -> None:
        BoundedHTTPConnection.connect(self)

    def _secure_socket(self) -> None:
        if self.sock is None:
            raise OSError("HTTPS connection has no socket.")
        self.sock.settimeout(remaining_seconds(self.connect_timeout))
        self.sock = self._context.wrap_socket(self.sock, server_hostname=self._tunnel_host or self.host)


class BoundedHTTPHandler(urllib.request.HTTPHandler):
    def __init__(self, dns_timeout: float, connect_timeout: float) -> None:
        super().__init__()
        self.dns_timeout = dns_timeout
        self.connect_timeout = connect_timeout

    def connection(self, host: str, **kwargs):
        connection = BoundedHTTPConnection(host, **kwargs)
        connection.dns_timeout = self.dns_timeout
        connection.connect_timeout = self.connect_timeout
        return connection

    def http_open(self, request):
        return self.do_open(self.connection, request)


class BoundedHTTPSHandler(urllib.request.HTTPSHandler):
    def __init__(self, dns_timeout: float, connect_timeout: float) -> None:
        super().__init__()
        self.dns_timeout = dns_timeout
        self.connect_timeout = connect_timeout

    def connection(self, host: str, **kwargs):
        connection = BoundedHTTPSConnection(host, **kwargs)
        connection.dns_timeout = self.dns_timeout
        connection.connect_timeout = self.connect_timeout
        return connection

    def https_open(self, request):
        return self.do_open(self.connection, request)
