For the MVP, everything can go through the Federation Node or direct HTTPS between nodes.

Don't care about:

NAT traversal
UDP hole punching
P2P
relays
WebRTC
voice/video
distributed storage

Yet.

Get this working first:

CNode starts
Node2 starts
Node2 registers with CNode
Node3 starts
Node3 registers with CNode
Create dave.node2
Create sarah.node3
Dave logs in
Sarah logs in
Dave sends Sarah "hello"
Sarah receives it in realtime
Kill Node3
Start Node3 again
Data is still there

Then you've got the foundation.

And make setup ridiculously simple

Eventually:

curl -fsSL https://get.yourproject.com | sh

Then:

╔══════════════════════════════════════╗
║          Welcome to Node             ║
╠══════════════════════════════════════╣
║                                      ║
║  What type of node is this?          ║
║                                      ║
║  > Community Node                    ║
║    Private Node                      ║
║                                      ║
║  Node name: node2                    ║
║                                      ║
║  Administrator:                      ║
║  Username: admin                     ║
║  Password: ********                  ║
║                                      ║
║             [ Install ]              ║
╚══════════════════════════════════════╝

And five minutes later:

Node running ✓


Web UI:
https://node2.example.com


Federation:
Connected ✓


Node ID:
node2


Users:
0