//! Tokenizer. No float literals exist in this language (INV-6): a numeric
//! literal with a `.` lexes directly to a `rust_decimal::Decimal`.

use rust_decimal::Decimal;
use std::str::FromStr;

use crate::ExprError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Token {
    Int(i64),
    Dec(Decimal),
    Str(String),
    Ident(String),
    True,
    False,
    Null,
    And,
    Or,
    Not,
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
    Plus,
    Minus,
    Star,
    Slash,
    LParen,
    RParen,
    Comma,
}

pub fn lex(src: &str) -> Result<Vec<Token>, ExprError> {
    let mut tokens = Vec::new();
    let bytes = src.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let c = bytes[i] as char;
        match c {
            ' ' | '\t' | '\n' | '\r' => i += 1,
            '(' => {
                tokens.push(Token::LParen);
                i += 1;
            }
            ')' => {
                tokens.push(Token::RParen);
                i += 1;
            }
            ',' => {
                tokens.push(Token::Comma);
                i += 1;
            }
            '+' => {
                tokens.push(Token::Plus);
                i += 1;
            }
            '-' => {
                tokens.push(Token::Minus);
                i += 1;
            }
            '*' => {
                tokens.push(Token::Star);
                i += 1;
            }
            '/' => {
                tokens.push(Token::Slash);
                i += 1;
            }
            '=' if bytes.get(i + 1) == Some(&b'=') => {
                tokens.push(Token::Eq);
                i += 2;
            }
            '!' if bytes.get(i + 1) == Some(&b'=') => {
                tokens.push(Token::Ne);
                i += 2;
            }
            '<' => {
                if bytes.get(i + 1) == Some(&b'=') {
                    tokens.push(Token::Le);
                    i += 2;
                } else {
                    tokens.push(Token::Lt);
                    i += 1;
                }
            }
            '>' => {
                if bytes.get(i + 1) == Some(&b'=') {
                    tokens.push(Token::Ge);
                    i += 2;
                } else {
                    tokens.push(Token::Gt);
                    i += 1;
                }
            }
            '"' => {
                let start = i + 1;
                let mut j = start;
                while j < bytes.len() && bytes[j] != b'"' {
                    j += 1;
                }
                if j >= bytes.len() {
                    return Err(ExprError::Lex("unterminated string literal".into()));
                }
                let s = std::str::from_utf8(&bytes[start..j])
                    .map_err(|_| ExprError::Lex("invalid utf-8 in string literal".into()))?;
                tokens.push(Token::Str(s.to_string()));
                i = j + 1;
            }
            '0'..='9' => {
                let start = i;
                let mut saw_dot = false;
                while i < bytes.len()
                    && (bytes[i].is_ascii_digit() || (bytes[i] == b'.' && !saw_dot))
                {
                    if bytes[i] == b'.' {
                        saw_dot = true;
                    }
                    i += 1;
                }
                let text = &src[start..i];
                if text.ends_with('.') {
                    return Err(ExprError::Lex(format!("malformed number: {text}")));
                }
                if saw_dot {
                    let d = Decimal::from_str(text)
                        .map_err(|_| ExprError::Lex(format!("malformed decimal: {text}")))?;
                    tokens.push(Token::Dec(d));
                } else {
                    let n: i64 = text
                        .parse()
                        .map_err(|_| ExprError::Lex(format!("integer out of range: {text}")))?;
                    tokens.push(Token::Int(n));
                }
            }
            'a'..='z' | 'A'..='Z' | '_' => {
                let start = i;
                while i < bytes.len()
                    && ((bytes[i] as char).is_ascii_alphanumeric() || bytes[i] == b'_')
                {
                    i += 1;
                }
                match &src[start..i] {
                    "and" => tokens.push(Token::And),
                    "or" => tokens.push(Token::Or),
                    "not" => tokens.push(Token::Not),
                    "true" => tokens.push(Token::True),
                    "false" => tokens.push(Token::False),
                    "null" => tokens.push(Token::Null),
                    ident => tokens.push(Token::Ident(ident.to_string())),
                }
            }
            other => return Err(ExprError::Lex(format!("unexpected character: {other:?}"))),
        }
    }
    Ok(tokens)
}
