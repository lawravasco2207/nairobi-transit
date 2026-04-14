use anyhow::{bail, Result};
use sqlx::PgPool;

use crate::db::vehicles::short_id_exists;

const DEFAULT_PREFIX: &str = "NRB";
const SACCO_STOP_WORDS: &[&str] = &["SACCO", "LTD", "LIMITED", "CO", "COMPANY"];

pub async fn generate_vehicle_short_id(
    pool: &PgPool,
    plate: &str,
    sacco_name: &str,
) -> Result<String> {
    let normalized_plate = normalize_alphanumeric(plate);
    let prefix = build_prefix(&normalized_plate, sacco_name);
    let starting_number = build_starting_number(&normalized_plate);

    for offset in 0..100 {
        let candidate = format!("{}{:02}", prefix, (starting_number + offset) % 100);
        if !short_id_exists(pool, &candidate).await? {
            return Ok(candidate);
        }
    }

    for number in 100..1000 {
        let candidate = format!("{}{:03}", prefix, number);
        if !short_id_exists(pool, &candidate).await? {
            return Ok(candidate);
        }
    }

    bail!("Unable to allocate a unique vehicle code for prefix {prefix}")
}

fn build_prefix(normalized_plate: &str, sacco_name: &str) -> String {
    let _ = normalized_plate;

    let mut prefix = String::from("N");
    let mut suffix_letters = sacco_code_letters(sacco_name);

    while suffix_letters.len() < 2 {
        suffix_letters.push(DEFAULT_PREFIX.chars().nth(suffix_letters.len() + 1).unwrap_or('R'));
    }

    prefix.push_str(&suffix_letters.into_iter().take(2).collect::<String>());
    prefix
}

fn build_starting_number(normalized_plate: &str) -> u32 {
    let digits: String = normalized_plate
        .chars()
        .filter(|c| c.is_ascii_digit())
        .collect();

    if digits.is_empty() {
        return 0;
    }

    let tail = if digits.len() >= 2 {
        &digits[digits.len() - 2..]
    } else {
        &digits
    };

    tail.parse::<u32>().unwrap_or(0)
}

fn normalize_alphanumeric(value: &str) -> String {
    value
        .trim()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_uppercase())
        .collect()
}

fn sacco_code_letters(sacco_name: &str) -> Vec<char> {
    let tokens: Vec<String> = sacco_name
        .split(|c: char| !c.is_ascii_alphabetic())
        .filter(|token| !token.is_empty())
        .map(|token| token.to_ascii_uppercase())
        .filter(|token| !SACCO_STOP_WORDS.contains(&token.as_str()))
        .collect();

    let mut letters = Vec::new();

    for token in tokens.iter().take(2) {
        if let Some(first) = token.chars().next() {
            letters.push(first);
        }
    }

    if letters.len() < 2 {
        for token in &tokens {
            for ch in token.chars().skip(1) {
                if letters.len() == 2 {
                    break;
                }
                letters.push(ch);
            }
            if letters.len() == 2 {
                break;
            }
        }
    }

    letters
}

#[cfg(test)]
mod tests {
    use super::{build_prefix, build_starting_number};

    #[test]
    fn derives_prefix_from_nairobi_and_sacco_initials() {
        assert_eq!(build_prefix("KDA123A", "City Hoppa SACCO"), "NCH");
        assert_eq!(build_prefix("KDA123A", "Super Metro"), "NSM");
    }

    #[test]
    fn falls_back_to_default_prefix_when_sacco_name_is_too_thin() {
        assert_eq!(build_prefix("12", "Metro"), "NME");
        assert_eq!(build_prefix("1", "7"), "NRB");
    }

    #[test]
    fn derives_suffix_from_last_two_plate_digits() {
        assert_eq!(build_starting_number("KDA123A"), 23);
        assert_eq!(build_starting_number("KBX7"), 7);
        assert_eq!(build_starting_number("KBX"), 0);
    }
}