//! Helpers to read typed values out of a slice of Modbus registers.
//! Multi-register values have the LOW word at the lower address.

/// INT: 1 register, signed.
pub fn int(w: &[u16], o: u16) -> i16 {
    w[o as usize] as i16
}

/// WORD: 1 register, unsigned.
pub fn word(w: &[u16], o: u16) -> u16 {
    w[o as usize]
}

fn u32_at(w: &[u16], o: u16) -> u32 {
    ((w[o as usize + 1] as u32) << 16) | w[o as usize] as u32
}

/// DINT: 2 registers, low word first.
pub fn dint(w: &[u16], o: u16) -> i32 {
    u32_at(w, o) as i32
}

/// REAL: 2 registers (IEEE 754 f32), low word first.
pub fn real(w: &[u16], o: u16) -> f32 {
    f32::from_bits(u32_at(w, o))
}

/// ASCII: `len` registers, 2 chars each, first char in the low byte.
/// Stops at the first 0 byte; surrounding whitespace is trimmed.
pub fn ascii(w: &[u16], o: u16, len: u16) -> String {
    let bytes: Vec<u8> = w[o as usize..(o + len) as usize]
        .iter()
        .flat_map(|r| [(*r & 0xFF) as u8, (*r >> 8) as u8])
        .take_while(|&b| b != 0)
        .collect();
    String::from_utf8_lossy(&bytes).trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_types() {
        let f = 12.5f32.to_bits();
        let w = [
            0xFFFF,
            (f & 0xFFFF) as u16,
            (f >> 16) as u16,
            u16::from_le_bytes(*b"AB"),
            u16::from_le_bytes([b'C', 0]),
            u16::from_le_bytes(*b"ZZ"),
        ];
        assert_eq!(int(&w, 0), -1);
        assert_eq!(word(&w, 0), 0xFFFF);
        assert_eq!(real(&w, 1), 12.5);
        assert_eq!(ascii(&w, 3, 3), "ABC");
    }
}
