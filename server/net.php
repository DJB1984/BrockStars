<?php
// BrockStars matchmaking. The players' browsers play each other directly over WebRTC; this script only
// introduces them. It keeps the open rooms and passes the handshake (an offer and an answer) between a
// joiner and the host. Plain PHP and files, so it runs on shared hosting. Every request is net.php?action=...
//   GET  rooms                              rooms hosted from the caller's network (same public address)
//   POST host  {name, level, room?}         opens a room (a random code, or `room`) → {room, peer: "h", key, ice}
//   POST join  {room, name}                 → {room, peer, key, host, ice}
//   POST send  {room, peer, key, to, data}  queues one message for another peer in the room
//   POST poll  {room, peer, key, players?}  → {messages}; the host's polls keep its room open
//   POST leave {room, peer, key}            the host leaving closes the room
// A net.config.php next to this file can add ICE servers (a TURN relay, for networks that block direct
// connections). It returns a list:
//   <?php return [['urls' => 'turn:relay.example.com:3478', 'username' => 'u', 'credential' => 'p']];

header('Content-Type: application/json');
header('Cache-Control: no-store');

const ROOM_TTL = 15;        // seconds a room stays open without its host polling
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_PLAYERS = 8;
const MAX_INBOX = 40;
const MAX_DATA = 24000;     // one handshake message (base64 SDP), in bytes

$DATA = __DIR__ . '/net-data';
if (!is_dir($DATA)) {
  @mkdir($DATA, 0700, true);
  file_put_contents("$DATA/.htaccess", "<IfModule mod_authz_core.c>\nRequire all denied\n</IfModule>\n"
                                     . "<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n");
}

class Refusal extends Exception {
  public $key;
  function __construct($key, $message) { parent::__construct($message); $this->key = $key; }
}

function reply($data, $status = 200) { http_response_code($status); echo json_encode($data); exit; }
function fail($key, $message, $status = 400) { reply(['error' => $message, 'code' => $key], $status); }

function ice() {
  $servers = [['urls' => ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478']]];
  $extra = __DIR__ . '/net.config.php';
  if (is_file($extra)) $servers = array_merge($servers, (array) include $extra);
  return $servers;
}

// Devices on one network share its public address. IPv6 gives every device its own, so compare the /64.
// Private and loopback addresses (a dev server on the LAN) all count as one network.
function network_of($ip) {
  if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false) return 'local';
  if (strpos($ip, ':') !== false) return bin2hex(substr(inet_pton($ip), 0, 8));
  return $ip;
}

function clean_code($code) {
  $code = strtoupper(trim((string) $code));
  return preg_match('/^[A-Z0-9]{4,8}$/', $code) ? $code : null;
}

function clean_name($name, $fallback = 'Player') {
  $name = trim(preg_replace('/[^\p{L}\p{N} _.\'!-]/u', '', (string) $name));
  $name = function_exists('mb_substr') ? mb_substr($name, 0, 16) : substr($name, 0, 16);
  return $name === '' ? $fallback : $name;
}

function token($bytes) { return bin2hex(random_bytes($bytes)); }
function room_path($code) { global $DATA; return "$DATA/room-$code.json"; }
function alive($room) { return $room && time() - $room['hostSeen'] < ROOM_TTL; }

// Runs $fn on the room under an exclusive lock. $fn returns [the room to save (null deletes it), result],
// or throws a Refusal, which leaves the room as it was and fails the request.
function with_room($code, $fn) {
  $path = room_path($code);
  $f = fopen($path, 'c+');
  if (!$f) fail('server', 'The game server could not open its room file.', 500);
  flock($f, LOCK_EX);
  $text = stream_get_contents($f);
  $before = $text ? json_decode($text, true) : null;
  $refusal = null;
  try {
    [$room, $result] = $fn($before);
  } catch (Refusal $e) {
    [$room, $refusal] = [$before, $e];
  }
  if ($room !== null) {
    ftruncate($f, 0);
    rewind($f);
    fwrite($f, json_encode($room));
    fflush($f);
  }
  flock($f, LOCK_UN);
  fclose($f);
  if ($room === null) @unlink($path);
  if ($refusal) fail($refusal->key, $refusal->getMessage(), 409);
  return $result;
}

// The caller must be the host or a peer of the room, with its key.
function check_peer($room, $peer, $key) {
  if (!$room) throw new Refusal('no-room', 'That game has ended.');
  $expected = $peer === 'h' ? $room['hostKey'] : ($room['peers'][$peer]['key'] ?? null);
  if (!$expected || !hash_equals($expected, (string) $key)) throw new Refusal('no-room', 'That game has ended.');
}

function sweep() {
  foreach (glob(room_path('*')) as $path) {
    if (filemtime($path) < time() - ROOM_TTL * 4) @unlink($path);
  }
}

$action = $_GET['action'] ?? '';
$in = json_decode(file_get_contents('php://input') ?: '{}', true) ?: [];
$network = network_of($_SERVER['REMOTE_ADDR'] ?? '');
$peer = (string) ($in['peer'] ?? '');
$key = (string) ($in['key'] ?? '');

if ($action === 'rooms') {
  sweep();
  $rooms = [];
  foreach (glob(room_path('*')) as $path) {
    $room = json_decode((string) @file_get_contents($path), true);
    if (alive($room) && $room['network'] === $network) {
      $rooms[] = ['room' => $room['code'], 'host' => $room['host'], 'level' => $room['level'], 'players' => $room['players']];
    }
  }
  reply(['rooms' => $rooms]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('method', 'Use POST for this.', 405);

if ($action !== 'host') {
  $code = clean_code($in['room'] ?? '');
  if (!$code) fail('bad-room', 'Room codes are 4 letters or numbers.');
}

switch ($action) {
  case 'host':
    sweep();
    $code = isset($in['room']) ? clean_code($in['room']) : null;
    if (isset($in['room']) && !$code) fail('bad-room', 'Room codes are 4 to 8 letters or numbers.');
    for ($tries = 0; !$code && $tries < 20; $tries++) {
      $try = '';
      for ($i = 0; $i < 4; $i++) $try .= CODE_CHARS[random_int(0, strlen(CODE_CHARS) - 1)];
      if (!is_file(room_path($try))) $code = $try;
    }
    if (!$code) fail('busy', 'No free room codes right now. Try again.', 503);
    $hostKey = token(16);
    with_room($code, function ($room) use ($code, $in, $network, $hostKey) {
      if (alive($room)) throw new Refusal('taken', "Room $code is already open.");
      return [['code' => $code, 'host' => clean_name($in['name'] ?? ''), 'level' => (string) ($in['level'] ?? ''),
               'network' => $network, 'hostKey' => $hostKey, 'hostSeen' => time(), 'players' => 1,
               'peers' => new stdClass(), 'inbox' => new stdClass()], null];
    });
    reply(['room' => $code, 'peer' => 'h', 'key' => $hostKey, 'ice' => ice()]);

  case 'join':
    $result = with_room($code, function ($room) use ($code, $in) {
      if (!alive($room)) throw new Refusal('no-room', "There's no open game with code $code.");
      if ($room['players'] >= MAX_PLAYERS) throw new Refusal('full', 'That game is full.');
      foreach ($room['peers'] as $id => $p) if ($p['seen'] < time() - 60) unset($room['peers'][$id]);
      $peer = token(3);
      $key = token(16);
      $room['peers'][$peer] = ['name' => clean_name($in['name'] ?? ''), 'key' => $key, 'seen' => time()];
      return [$room, ['room' => $code, 'peer' => $peer, 'key' => $key, 'host' => $room['host']]];
    });
    reply($result + ['ice' => ice()]);

  case 'send':
    $to = (string) ($in['to'] ?? '');
    $data = (string) ($in['data'] ?? '');
    if (strlen($data) > MAX_DATA) fail('too-big', 'That message is too big.');
    with_room($code, function ($room) use ($peer, $key, $to, $data) {
      check_peer($room, $peer, $key);
      if ($to !== 'h' && !isset($room['peers'][$to])) throw new Refusal('no-peer', 'That player has left.');
      $room['inbox'][$to][] = ['from' => $peer, 'data' => $data];
      $room['inbox'][$to] = array_slice($room['inbox'][$to], -MAX_INBOX);
      return [$room, null];
    });
    reply(['ok' => true]);

  case 'poll':
    $messages = with_room($code, function ($room) use ($peer, $key, $in) {
      check_peer($room, $peer, $key);
      if ($peer === 'h') {
        $room['hostSeen'] = time();
        if (isset($in['players'])) $room['players'] = max(1, min(MAX_PLAYERS, (int) $in['players']));
      } else {
        if (!alive($room)) throw new Refusal('no-room', 'That game has ended.');
        $room['peers'][$peer]['seen'] = time();
      }
      $messages = $room['inbox'][$peer] ?? [];
      unset($room['inbox'][$peer]);
      if (!$room['inbox']) $room['inbox'] = new stdClass();
      return [$room, $messages];
    });
    reply(['messages' => $messages]);

  case 'leave':
    with_room($code, function ($room) use ($peer, $key) {
      check_peer($room, $peer, $key);
      if ($peer === 'h') return [null, null];
      unset($room['peers'][$peer], $room['inbox'][$peer]);
      if (!$room['peers']) $room['peers'] = new stdClass();
      if (!$room['inbox']) $room['inbox'] = new stdClass();
      return [$room, null];
    });
    reply(['ok' => true]);
}

fail('action', 'Unknown action.', 404);
