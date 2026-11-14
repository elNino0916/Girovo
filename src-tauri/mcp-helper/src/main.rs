// girovo-mcp: see src/lib.rs. MCP over stdin and stdout, one JSON message
// per line; whatever it has to say for people goes to stderr, which MCP
// clients keep as the server's log.

use std::io::BufRead;
use std::sync::Arc;

fn main() {
  let config = girovo_mcp::Config::from_env();
  let lines = std::io::stdin().lock().lines();
  girovo_mcp::serve(lines, Arc::new(girovo_mcp::Stdout), config);
}
