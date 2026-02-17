-- Users Table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'admin',
    is_active BOOLEAN DEFAULT true,
    last_login_at TIMESTAMP,
    login_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMP,
    reset_token VARCHAR(255),
    reset_token_expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- Admin Sessions Table
CREATE TABLE IF NOT EXISTS admin_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(500) NOT NULL UNIQUE,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    last_activity_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessions_token ON admin_sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON admin_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON admin_sessions(expires_at);

-- Assessments Table
CREATE TABLE IF NOT EXISTS assessments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version INTEGER NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    is_published BOOLEAN DEFAULT false,
    published_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id),
    estimated_duration_minutes INTEGER,
    instructions TEXT
);

-- Dimensions Table
CREATE TABLE IF NOT EXISTS dimensions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id UUID NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
    dimension_key VARCHAR(100) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(100),
    order_index INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_dimension_per_assessment UNIQUE (assessment_id, dimension_key)
);

-- Topics Table
CREATE TABLE IF NOT EXISTS topics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dimension_id UUID NOT NULL REFERENCES dimensions(id) ON DELETE CASCADE,
    topic_key VARCHAR(100) NOT NULL,
    label VARCHAR(255) NOT NULL,
    prompt TEXT NOT NULL,
    order_index INTEGER NOT NULL,
    help_text TEXT,
    example TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_topic_per_dimension UNIQUE (dimension_id, topic_key)
);

-- Participants Table
CREATE TABLE IF NOT EXISTS participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    full_name VARCHAR(255) NOT NULL,
    company_name VARCHAR(255),
    job_title VARCHAR(255),
    phone VARCHAR(50),
    industry VARCHAR(100),
    company_size VARCHAR(50),
    country VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    consent_given BOOLEAN DEFAULT false,
    consent_date TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_participants_email ON participants(email);
CREATE INDEX IF NOT EXISTS idx_participants_company ON participants(company_name);

-- Assessment Responses Table
CREATE TABLE IF NOT EXISTS assessment_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id UUID NOT NULL REFERENCES assessments(id),
    participant_id UUID NOT NULL REFERENCES participants(id),
    status VARCHAR(50) DEFAULT 'in_progress',
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    last_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    total_questions INTEGER,
    answered_questions INTEGER DEFAULT 0,
    progress_percentage DECIMAL(5,2) DEFAULT 0.00,
    session_token VARCHAR(255) UNIQUE,
    ip_address INET,
    user_agent TEXT,
    overall_score DECIMAL(5,2),
    overall_gap DECIMAL(5,2)
);

CREATE INDEX IF NOT EXISTS idx_responses_participant ON assessment_responses(participant_id);
CREATE INDEX IF NOT EXISTS idx_responses_assessment ON assessment_responses(assessment_id);
CREATE INDEX IF NOT EXISTS idx_responses_status ON assessment_responses(status);
CREATE INDEX IF NOT EXISTS idx_responses_completed ON assessment_responses(completed_at);

-- Topic Responses Table
CREATE TABLE IF NOT EXISTS topic_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    response_id UUID NOT NULL REFERENCES assessment_responses(id) ON DELETE CASCADE,
    topic_id UUID NOT NULL REFERENCES topics(id),
    current_rating DECIMAL(5,2) CHECK (current_rating >= 1 AND current_rating <= 5),
    target_rating DECIMAL(5,2) CHECK (target_rating >= 1 AND target_rating <= 5),
    gap DECIMAL(5,2),
    normalized_gap DECIMAL(5,2),
    answered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    time_spent_seconds INTEGER,
    notes TEXT,
    CONSTRAINT unique_topic_response UNIQUE (response_id, topic_id)
);

CREATE INDEX IF NOT EXISTS idx_topic_responses_response ON topic_responses(response_id);
CREATE INDEX IF NOT EXISTS idx_topic_responses_topic ON topic_responses(topic_id);

-- Computed Priorities Table
CREATE TABLE IF NOT EXISTS computed_priorities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    response_id UUID NOT NULL REFERENCES assessment_responses(id) ON DELETE CASCADE,
    dimension_id UUID NOT NULL REFERENCES dimensions(id),
    dimension_score DECIMAL(5,2),
    dimension_gap DECIMAL(5,2),
    priority_score DECIMAL(5,2),
    rank_order INTEGER,
    recommendations JSONB,
    computed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_dimension_priority UNIQUE (response_id, dimension_id)
);

CREATE INDEX IF NOT EXISTS idx_priorities_response ON computed_priorities(response_id);
CREATE INDEX IF NOT EXISTS idx_priorities_score ON computed_priorities(priority_score DESC);

-- Recommendations Table
CREATE TABLE IF NOT EXISTS recommendations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dimension_id UUID NOT NULL REFERENCES dimensions(id),
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    action_items JSONB,
    resources JSONB,
    min_gap DECIMAL(5,2),
    max_gap DECIMAL(5,2),
    priority_level VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_recommendations_dimension ON recommendations(dimension_id);

-- System Settings Table
CREATE TABLE IF NOT EXISTS system_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    setting_key VARCHAR(100) NOT NULL UNIQUE,
    setting_value JSONB NOT NULL,
    description TEXT,
    updated_by UUID REFERENCES users(id),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_settings_key ON system_settings(setting_key);

-- Audit Logs Table
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type VARCHAR(100),
    entity_id UUID,
    action VARCHAR(50),
    user_id UUID,
    changes JSONB,
    ip_address INET,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);

-- Admin Notifications Table
CREATE TABLE IF NOT EXISTS admin_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    type VARCHAR(50),
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    link VARCHAR(500),
    is_read BOOLEAN DEFAULT false,
    read_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON admin_notifications(user_id);
