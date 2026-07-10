//! Recursive-descent parser producing the expression AST. Nesting depth is
//! bounded so adversarial input cannot blow the stack (INV-7 at parse time).

use rust_decimal::Decimal;

use crate::lexer::{lex, Token};
use crate::ExprError;

const MAX_DEPTH: usize = 64;

#[derive(Debug, Clone, PartialEq)]
pub enum Expr {
    Bool(bool),
    Int(i64),
    Dec(Decimal),
    Str(String),
    Null,
    Ident(String),
    Not(Box<Expr>),
    Neg(Box<Expr>),
    Binary(BinOp, Box<Expr>, Box<Expr>),
    Call(String, Vec<Expr>),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BinOp {
    And,
    Or,
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
    Add,
    Sub,
    Mul,
    Div,
}

pub fn parse(src: &str) -> Result<Expr, ExprError> {
    let tokens = lex(src)?;
    let mut p = Parser { tokens, pos: 0 };
    let expr = p.or_expr(0)?;
    if p.pos != p.tokens.len() {
        return Err(ExprError::Parse("trailing input after expression".into()));
    }
    Ok(expr)
}

struct Parser {
    tokens: Vec<Token>,
    pos: usize,
}

impl Parser {
    fn peek(&self) -> Option<&Token> {
        self.tokens.get(self.pos)
    }

    fn bump(&mut self) -> Option<Token> {
        let t = self.tokens.get(self.pos).cloned();
        if t.is_some() {
            self.pos += 1;
        }
        t
    }

    fn guard(depth: usize) -> Result<(), ExprError> {
        if depth > MAX_DEPTH {
            return Err(ExprError::Parse("expression nesting too deep".into()));
        }
        Ok(())
    }

    fn or_expr(&mut self, depth: usize) -> Result<Expr, ExprError> {
        Self::guard(depth)?;
        let mut left = self.and_expr(depth + 1)?;
        while self.peek() == Some(&Token::Or) {
            self.bump();
            let right = self.and_expr(depth + 1)?;
            left = Expr::Binary(BinOp::Or, Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    fn and_expr(&mut self, depth: usize) -> Result<Expr, ExprError> {
        Self::guard(depth)?;
        let mut left = self.unary_expr(depth + 1)?;
        while self.peek() == Some(&Token::And) {
            self.bump();
            let right = self.unary_expr(depth + 1)?;
            left = Expr::Binary(BinOp::And, Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    fn unary_expr(&mut self, depth: usize) -> Result<Expr, ExprError> {
        Self::guard(depth)?;
        if self.peek() == Some(&Token::Not) {
            self.bump();
            let inner = self.unary_expr(depth + 1)?;
            return Ok(Expr::Not(Box::new(inner)));
        }
        self.cmp_expr(depth + 1)
    }

    fn cmp_expr(&mut self, depth: usize) -> Result<Expr, ExprError> {
        Self::guard(depth)?;
        let left = self.add_expr(depth + 1)?;
        let op = match self.peek() {
            Some(Token::Eq) => BinOp::Eq,
            Some(Token::Ne) => BinOp::Ne,
            Some(Token::Lt) => BinOp::Lt,
            Some(Token::Le) => BinOp::Le,
            Some(Token::Gt) => BinOp::Gt,
            Some(Token::Ge) => BinOp::Ge,
            _ => return Ok(left),
        };
        self.bump();
        let right = self.add_expr(depth + 1)?;
        Ok(Expr::Binary(op, Box::new(left), Box::new(right)))
    }

    fn add_expr(&mut self, depth: usize) -> Result<Expr, ExprError> {
        Self::guard(depth)?;
        let mut left = self.mul_expr(depth + 1)?;
        loop {
            let op = match self.peek() {
                Some(Token::Plus) => BinOp::Add,
                Some(Token::Minus) => BinOp::Sub,
                _ => return Ok(left),
            };
            self.bump();
            let right = self.mul_expr(depth + 1)?;
            left = Expr::Binary(op, Box::new(left), Box::new(right));
        }
    }

    fn mul_expr(&mut self, depth: usize) -> Result<Expr, ExprError> {
        Self::guard(depth)?;
        let mut left = self.neg_expr(depth + 1)?;
        loop {
            let op = match self.peek() {
                Some(Token::Star) => BinOp::Mul,
                Some(Token::Slash) => BinOp::Div,
                _ => return Ok(left),
            };
            self.bump();
            let right = self.neg_expr(depth + 1)?;
            left = Expr::Binary(op, Box::new(left), Box::new(right));
        }
    }

    fn neg_expr(&mut self, depth: usize) -> Result<Expr, ExprError> {
        Self::guard(depth)?;
        if self.peek() == Some(&Token::Minus) {
            self.bump();
            let inner = self.neg_expr(depth + 1)?;
            return Ok(Expr::Neg(Box::new(inner)));
        }
        self.primary(depth + 1)
    }

    fn primary(&mut self, depth: usize) -> Result<Expr, ExprError> {
        Self::guard(depth)?;
        match self.bump() {
            Some(Token::Int(n)) => Ok(Expr::Int(n)),
            Some(Token::Dec(d)) => Ok(Expr::Dec(d)),
            Some(Token::Str(s)) => Ok(Expr::Str(s)),
            Some(Token::True) => Ok(Expr::Bool(true)),
            Some(Token::False) => Ok(Expr::Bool(false)),
            Some(Token::Null) => Ok(Expr::Null),
            Some(Token::LParen) => {
                let inner = self.or_expr(depth + 1)?;
                match self.bump() {
                    Some(Token::RParen) => Ok(inner),
                    _ => Err(ExprError::Parse("expected closing parenthesis".into())),
                }
            }
            Some(Token::Ident(name)) => {
                if self.peek() == Some(&Token::LParen) {
                    self.bump();
                    let mut args = Vec::new();
                    if self.peek() != Some(&Token::RParen) {
                        loop {
                            args.push(self.or_expr(depth + 1)?);
                            match self.peek() {
                                Some(Token::Comma) => {
                                    self.bump();
                                }
                                _ => break,
                            }
                        }
                    }
                    match self.bump() {
                        Some(Token::RParen) => Ok(Expr::Call(name, args)),
                        _ => Err(ExprError::Parse(
                            "expected closing parenthesis in call".into(),
                        )),
                    }
                } else {
                    Ok(Expr::Ident(name))
                }
            }
            other => Err(ExprError::Parse(format!("unexpected token: {other:?}"))),
        }
    }
}
